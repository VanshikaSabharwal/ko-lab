import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "../../../../lib/prisma";
import { getSessionUser, unauthorized } from "../../../../lib/apiAuth";
import { ACTION_TTL_MS, ActionError, executeAction } from "../../../../lib/assistantActions";

/**
 * The user's answer to a change the assistant proposed: { decision: "confirm" }
 * carries it out, { decision: "cancel" } drops it. Either way the row stays as
 * the record of what was asked for and what happened.
 */
export async function POST(req: Request, { params }: { params: { actionId: string } }) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const body = await req.json().catch(() => null);
  const decision = body?.decision;
  if (decision !== "confirm" && decision !== "cancel") {
    return NextResponse.json({ error: 'decision must be "confirm" or "cancel"' }, { status: 400 });
  }

  // Scoped to the caller: one user can never confirm another's proposal.
  const action = await prisma.assistantAction.findFirst({
    where: { id: params.actionId, userId: me.id },
    select: { id: true, tool: true, args: true, status: true, createdAt: true },
  });
  if (!action) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action.status !== "PENDING") {
    return NextResponse.json(
      { error: "This change was already handled.", status: action.status },
      { status: 409 },
    );
  }

  const now = new Date();
  if (now.getTime() - action.createdAt.getTime() > ACTION_TTL_MS) {
    await prisma.assistantAction.updateMany({
      where: { id: action.id, status: "PENDING" },
      data: { status: "EXPIRED", decidedAt: now },
    });
    return NextResponse.json(
      { error: "This proposal expired. Ask the assistant again.", status: "EXPIRED" },
      { status: 410 },
    );
  }

  // Claim the row before doing anything. The guard is in the WHERE clause, so
  // a double click (or two tabs) can't run the same change twice.
  const { count } = await prisma.assistantAction.updateMany({
    where: { id: action.id, status: "PENDING" },
    data: { status: decision === "confirm" ? "EXECUTED" : "CANCELLED", decidedAt: now },
  });
  if (count === 0) {
    return NextResponse.json({ error: "This change was already handled." }, { status: 409 });
  }

  if (decision === "cancel") {
    return NextResponse.json({ status: "CANCELLED", message: "Cancelled — nothing was changed." });
  }

  try {
    const result = await executeAction(action.tool, action.args, me.id);
    await prisma.assistantAction.update({
      where: { id: action.id },
      data: { result: result as unknown as Prisma.InputJsonValue },
    });
    return NextResponse.json({ status: "EXECUTED", ...result });
  } catch (error) {
    const message =
      error instanceof ActionError
        ? error.message
        : "Something went wrong. Check the board before trying again.";
    if (!(error instanceof ActionError)) console.error("Assistant action failed:", error);
    await prisma.assistantAction.update({
      where: { id: action.id },
      data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) },
    });
    return NextResponse.json({ status: "FAILED", error: message }, { status: 422 });
  }
}
