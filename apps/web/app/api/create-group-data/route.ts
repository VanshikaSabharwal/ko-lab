import { NextResponse } from "next/server";
// The shared client: a route-local one that disconnected after every request
// opened a fresh connection to the database each time, which is most of what
// made creating a group slow.
import prisma from "../../lib/prisma";
import { encrypt } from "../../lib/encryption";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../lib/apiAuth";
import { revokeCollaborator } from "../../lib/githubCollaborator";

export async function POST(req: Request) {
  try {
    const me = await getSessionUser();
    if (!me) return unauthorized();

    const {
      groupName,
      githubRepo,
      githubOwnerName,
      githubAccessToken,
      sshKey,
    } = await req.json();
    const ownerId = me.id;

    console.log("📩 Incoming Body:", {
      groupName,
      githubRepo,
      githubOwnerName,
      githubAccessTokenLength: githubAccessToken?.length,
      ownerId,
      sshKeyLength: sshKey?.length,
    });

    if (!groupName)
      return NextResponse.json(
        { error: "Group name is required" },
        { status: 400 },
      );

    if (!githubRepo)
      return NextResponse.json(
        { error: "GitHub repo is required" },
        { status: 400 },
      );

    if (!githubAccessToken)
      return NextResponse.json(
        { error: "GitHub access token is required" },
        { status: 400 },
      );

    // The GitHub token check and the duplicate check don't depend on each
    // other, so they run together rather than one after the other.
    const [tokenCheck, groupExists] = await Promise.all([
      fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${githubAccessToken}`,
          Accept: "application/vnd.github.v3+json",
        },
      }).catch(() => null),
      prisma.group.findFirst({
        where: {
          ownerId,
          ownerName: githubOwnerName,
          githubRepo,
          groupName,
        },
        select: { id: true },
      }),
    ]);

    if (!tokenCheck) {
      return NextResponse.json(
        { error: "Failed to verify GitHub token. Check your network." },
        { status: 502 },
      );
    }
    if (!tokenCheck.ok) {
      const err = await tokenCheck.json().catch(() => ({}));
      return NextResponse.json(
        {
          error: `GitHub token is invalid: ${err.message || tokenCheck.statusText}. Try reconnecting your GitHub account or use a valid PAT.`,
        },
        { status: 401 },
      );
    }

    if (groupExists) {
      return NextResponse.json(
        { error: "Group already exists!" },
        { status: 409 },
      );
    }

    const encryptedAccessToken = encrypt(githubAccessToken);
    const encryptedSshKey = sshKey ? encrypt(sshKey) : null;

    console.log("➡️ Data being saved in DB:", {
      groupName,
      githubRepo,
      ownerName: githubOwnerName,
      ownerId,
      encryptedSshKeyPresent: !!encryptedSshKey,
      encryptedAccessTokenPresent: !!encryptedAccessToken,
    });

    const group = await prisma.group.create({
      data: {
        groupName,
        githubRepo,
        ownerName: githubOwnerName,
        githubAccessToken: encryptedAccessToken,
        sshKey: encryptedSshKey,
        ownerId,
      },
      // Never send the stored token or SSH key back, even encrypted
      select: { id: true, groupName: true, githubRepo: true },
    });

    return NextResponse.json(group, { status: 201 });
  } catch (err: any) {
    console.error("🔥 ERROR IN CREATE-GROUP API");
    console.error("Message:", err.message);
    console.error("Stack:", err.stack);

    return NextResponse.json(
      { error: err.message ?? "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  try {
    const me = await getSessionUser();
    if (!me) return unauthorized();

    const url = new URL(req.url);
    const groupId = url.searchParams.get("group");

    if (!groupId) {
      return NextResponse.json(
        { error: "Group ID parameter is required" },
        { status: 400 },
      );
    }

    if (!(await isGroupMember(groupId, me.id))) {
      return forbidden("Not a member of this group");
    }

    // Fetch only the non-sensitive group fields. The GitHub token and SSH key
    // MUST NOT be sent to the browser — all GitHub calls are proxied
    // server-side (see /api/files, /api/file-content, /api/vcs/*). Exposing
    // them here would let any member exfiltrate the owner's repo credentials.
    const groupDetails = await prisma.group.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        groupName: true,
        githubRepo: true,
        ownerName: true,
        ownerId: true,
        liveUrl: true,
        image: true,
        defaultBranch: true,
        createdAt: true,
        // A boolean flag is safe to expose; the key itself is not.
        sshKey: true,
      },
    });

    if (!groupDetails) {
      return NextResponse.json(
        { error: `Group with ID ${groupId} not found` },
        { status: 404 },
      );
    }

    const { sshKey, ...safe } = groupDetails;
    return NextResponse.json(
      { ...safe, hasSshKey: !!sshKey },
      { status: 200 },
    );
  } catch (err) {
    console.error("Error fetching group:", err);
    return NextResponse.json(
      { error: "Failed to fetch group data" },
      { status: 500 },
    );
  }
}

// PATCH — rename a group (owner only)
export async function PATCH(req: Request) {
  try {
    const me = await getSessionUser();
    if (!me) return unauthorized();

    const { groupId, groupName } = await req.json();

    if (!groupId || !groupName?.trim()) {
      return NextResponse.json(
        { error: "groupId and a non-empty groupName are required" },
        { status: 400 },
      );
    }

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { ownerId: true },
    });
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }
    if (group.ownerId !== me.id) {
      return NextResponse.json(
        { error: "Only the group owner can rename this group" },
        { status: 403 },
      );
    }

    const updated = await prisma.group.update({
      where: { id: groupId },
      data: { groupName: groupName.trim() },
      select: { groupName: true },
    });

    return NextResponse.json({ groupName: updated.groupName }, { status: 200 });
  } catch (err: any) {
    console.error("Error renaming group:", err);
    return NextResponse.json(
      { error: err.message ?? "Failed to rename group" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const me = await getSessionUser();
    if (!me) return unauthorized();

    const { groupId } = await req.json();

    if (!groupId) {
      return NextResponse.json(
        { error: "Group ID is required" },
        { status: 400 },
      );
    }

    const group = await prisma.group.findUnique({
      where: { id: groupId },
      select: { ownerId: true },
    });

    if (!group) {
      return NextResponse.json(
        { error: "Group not found" },
        { status: 404 },
      );
    }

    if (group.ownerId !== me.id) {
      return NextResponse.json(
        { error: "Only the group owner can delete this group" },
        { status: 403 },
      );
    }

    // Revoke repo access BEFORE the rows go away — once groupMember is deleted
    // there is no record of who to revoke, and their GitHub push rights would
    // outlive the group with nothing in the UI to reveal it. Best-effort: a
    // GitHub failure must not block the owner from deleting their own group.
    const membersToRevoke = await prisma.groupMember.findMany({
      where: { groupId, codeAccess: { in: ["INVITED", "ACTIVE"] } },
      select: { userId: true },
    });
    await Promise.all(
      membersToRevoke.map((m) =>
        revokeCollaborator(groupId, m.userId).catch((err) =>
          console.error(`Failed to revoke ${m.userId} on group delete:`, err),
        ),
      ),
    );

    await prisma.$transaction(async (tx) => {
      await tx.change.deleteMany({
        where: { file: { groupId } },
      });

      await tx.modifiedFiles.deleteMany({ where: { groupId } });

      await tx.groupMember.deleteMany({ where: { groupId } });

      await tx.groupMessage.deleteMany({ where: { groupId } });

      await tx.invite.deleteMany({ where: { groupId } });

      await tx.notifications.deleteMany({ where: { groupId } });

      await tx.rejectedCr.deleteMany({ where: { groupId } });

      await tx.approvedCr.deleteMany({ where: { groupId } });

      await tx.guestGroup.deleteMany({ where: { groupId } });

      await tx.callRoom.deleteMany({ where: { groupId } });

      await tx.file.deleteMany({ where: { group: groupId } });

      await tx.group.delete({ where: { id: groupId } });
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: any) {
    console.error("Error deleting group:", err);
    return NextResponse.json(
      { error: err.message ?? "Failed to delete group" },
      { status: 500 },
    );
  }
}
