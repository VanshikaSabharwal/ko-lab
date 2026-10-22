import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../../../lib/apiAuth";

const SLUG_TO_TYPE: Record<string, "MIND_MAP" | "PLANNING" | "DB_SCHEMA" | "UI_DESIGN"> = {
  "mind-map": "MIND_MAP",
  "planning": "PLANNING",
  "db-schema": "DB_SCHEMA",
  "ui-design": "UI_DESIGN",
};

const DEFAULT_CONTENT: Record<string, unknown> = {
  MIND_MAP: { nodes: [], edges: [] },
  DB_SCHEMA: { nodes: [], edges: [] },
  UI_DESIGN: { nodes: [], edges: [] },
  PLANNING: { columns: [], cards: {}, milestones: [] },
};

export async function GET(
  req: Request,
  { params }: { params: { groupId: string; type: string } },
) {
  const { groupId, type: slug } = params;
  const type = SLUG_TO_TYPE[slug];
  if (!type) {
    return NextResponse.json({ error: "Invalid workspace board type" }, { status: 400 });
  }

  const me = await getSessionUser();
  if (!me) return unauthorized();

  if (!(await isGroupMember(groupId, me.id))) {
    return forbidden("Not a member of this group");
  }

  const board = await prisma.workspaceBoard.findUnique({
    where: { groupId_type: { groupId, type } },
  });

  return NextResponse.json({
    content: board?.content ?? DEFAULT_CONTENT[type],
    updatedAt: board?.updatedAt ?? null,
  });
}

export async function PUT(
  req: Request,
  { params }: { params: { groupId: string; type: string } },
) {
  const { groupId, type: slug } = params;
  const type = SLUG_TO_TYPE[slug];
  if (!type) {
    return NextResponse.json({ error: "Invalid workspace board type" }, { status: 400 });
  }

  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { content, baseUpdatedAt } = await req.json();
  if (content === undefined) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  if (!(await isGroupMember(groupId, me.id))) {
    return forbidden("Not a member of this group");
  }

  // Each browser saves the whole board. Saving over a version you never saw
  // silently erased whatever the other person had added, so a save says which
  // version it was made from (`baseUpdatedAt`; null for a board that didn't
  // exist yet), and is refused if the board has moved on since. The refusal
  // carries the current board for the browser to merge into and save again.
  if (baseUpdatedAt !== undefined) {
    const conflict = async () => {
      const current = await prisma.workspaceBoard.findUnique({
        where: { groupId_type: { groupId, type } },
      });
      return NextResponse.json(
        { error: "The board changed since you loaded it", content: current?.content, updatedAt: current?.updatedAt },
        { status: 409 },
      );
    };

    if (baseUpdatedAt === null) {
      try {
        const board = await prisma.workspaceBoard.create({ data: { groupId, type, content } });
        return NextResponse.json({ content: board.content, updatedAt: board.updatedAt });
      } catch (err: any) {
        // Someone else created it first
        if (err?.code === "P2002") return conflict();
        throw err;
      }
    }

    const base = new Date(baseUpdatedAt);
    if (Number.isNaN(base.getTime())) {
      return NextResponse.json({ error: "baseUpdatedAt is not a date" }, { status: 400 });
    }
    // One statement: only writes if the version is still the one the browser
    // saw. The new version is set here rather than read back afterwards, when
    // it could already be someone else's.
    const updatedAt = new Date();
    const { count } = await prisma.workspaceBoard.updateMany({
      where: { groupId, type, updatedAt: base },
      data: { content, updatedAt },
    });
    if (count === 0) return conflict();
    return NextResponse.json({ content, updatedAt });
  }

  // Older clients that don't send a version: the previous last-write-wins save
  const board = await prisma.workspaceBoard.upsert({
    where: { groupId_type: { groupId, type } },
    update: { content },
    create: { groupId, type, content },
  });

  return NextResponse.json({ content: board.content, updatedAt: board.updatedAt });
}
