import { NextResponse } from "next/server";
import prisma from "../../../lib/prisma";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../../lib/apiAuth";
import { getRepoContext, isGitHubAuthError } from "../../../lib/vcs";

// GET — branches for the group repo, for the editor's branch switcher.
// Default branch is flagged; open CR branches are grouped separately.
// Query: ?groupId=...
export async function GET(req: Request) {
  const me = await getSessionUser();
  if (!me) return unauthorized();

  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("groupId");
  if (!groupId) return NextResponse.json({ error: "groupId is required" }, { status: 400 });

  if (!(await isGroupMember(groupId, me.id))) {
    return forbidden("Not a member of this group");
  }

  let ctx;
  try {
    ctx = await getRepoContext(groupId);
  } catch (err: any) {
    if (isGitHubAuthError(err)) {
      return NextResponse.json(
        { error: "GitHub access expired — reconnect GitHub", code: "GITHUB_AUTH_EXPIRED" },
        { status: 401 },
      );
    }
    return NextResponse.json({ error: `Couldn't reach the repo: ${err.message}` }, { status: 502 });
  }

  const [{ data }, openCrs] = await Promise.all([
    ctx.octokit.rest.repos.listBranches({
      owner: ctx.owner,
      repo: ctx.repo,
      per_page: 100,
    }),
    prisma.changeRequest.findMany({
      where: { groupId, status: "OPEN" },
      select: { branchName: true },
    }),
  ]);
  const crBranchNames = new Set(openCrs.map((c) => c.branchName));

  const branches = data.map((b) => ({
    name: b.name,
    sha: b.commit.sha,
    isDefault: b.name === ctx.defaultBranch,
    isChangeRequest: crBranchNames.has(b.name),
  }));

  return NextResponse.json({ defaultBranch: ctx.defaultBranch, branches });
}
