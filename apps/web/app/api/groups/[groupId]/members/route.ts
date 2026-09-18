import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../../../lib/apiAuth";

/**
 * Members of a group with the fields needed to render an avatar: id, name,
 * image, role.
 *
 * Nothing existing covers this — `check-group-member` returns only
 * `{exists}`, and `github/collaborator` is owner-scoped and reconciles against
 * the GitHub API on every call, which is far too heavy for a sidebar.
 */
export async function GET(_req: Request, { params }: { params: { groupId: string } }) {
  const { groupId } = params;

  const me = await getSessionUser();
  if (!me) return unauthorized();
  if (!(await isGroupMember(groupId, me.id))) {
    return forbidden("Not a member of this group");
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      ownerId: true,
      groupName: true,
      owner: { select: { id: true, name: true, image: true, email: true } },
      members: {
        select: {
          role: true,
          user: { select: { id: true, name: true, image: true, email: true } },
        },
      },
    },
  });

  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  // The owner has no GroupMember row, so they'd be missing from the stack
  // entirely. Seed the map with them, then let any explicit membership row
  // override — without dropping their OWNER role.
  // email travels with each member so the UI can tell apart two accounts that
  // share a display name — otherwise the same name appears twice with nothing
  // to distinguish them.
  const byId = new Map<
    string,
    { id: string; name: string | null; email: string | null; image: string | null; role: string }
  >();

  if (group.owner) {
    byId.set(group.owner.id, {
      id: group.owner.id,
      name: group.owner.name,
      email: group.owner.email,
      image: group.owner.image,
      role: "OWNER",
    });
  }

  for (const m of group.members) {
    if (byId.has(m.user.id)) continue;
    byId.set(m.user.id, {
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      image: m.user.image,
      role: m.role,
    });
  }

  return NextResponse.json({
    groupName: group.groupName,
    members: Array.from(byId.values()),
  });
}
