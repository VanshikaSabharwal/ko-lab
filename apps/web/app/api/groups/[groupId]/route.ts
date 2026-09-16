import { NextResponse } from "next/server";
import { z } from "zod";
import prisma from "../../../lib/prisma";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../../lib/apiAuth";

/**
 * Project details shown in the planning workspace's details panel.
 *
 * Separate from `members/route.ts` (which returns the roster) because this is
 * group metadata, and writing it is owner-only rather than member-wide.
 */

const patchGroup = z
  .object({
    description: z.string().max(2000).nullable().optional(),
    // A URL, not an upload — there's no image pipeline for group covers yet.
    // https only: an http cover would be blocked by the CSP img-src in prod.
    coverImage: z
      .string()
      .url()
      .startsWith("https://", "Cover image must be an https URL")
      .max(2048)
      .nullable()
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No fields to update");

type Params = { params: { groupId: string } };

export async function GET(_req: Request, { params }: Params) {
  const { groupId } = params;

  const me = await getSessionUser();
  if (!me) return unauthorized();
  if (!(await isGroupMember(groupId, me.id))) {
    return forbidden("Not a member of this group");
  }

  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      groupName: true,
      description: true,
      coverImage: true,
      githubRepo: true,
      ownerId: true,
      createdAt: true,
    },
  });
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

  return NextResponse.json({
    id: group.id,
    groupName: group.groupName,
    description: group.description,
    coverImage: group.coverImage,
    githubRepo: group.githubRepo,
    createdAt: group.createdAt.toISOString(),
    // Lets the client hide the edit affordance rather than offer it and 403.
    isOwner: group.ownerId === me.id,
  });
}

export async function PATCH(req: Request, { params }: Params) {
  const { groupId } = params;

  const me = await getSessionUser();
  if (!me) return unauthorized();

  // Deliberately stricter than isGroupMember: project metadata is the owner's
  // to set, so any member being able to rewrite the description would be wrong.
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { ownerId: true },
  });
  if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
  if (group.ownerId !== me.id) {
    return forbidden("Only the project owner can edit these details");
  }

  const parsed = patchGroup.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  const body = parsed.data;

  const updated = await prisma.group.update({
    where: { id: groupId },
    data: {
      ...(body.description !== undefined && { description: body.description }),
      ...(body.coverImage !== undefined && { coverImage: body.coverImage }),
    },
    select: { id: true, groupName: true, description: true, coverImage: true },
  });

  return NextResponse.json({ ...updated, isOwner: true });
}
