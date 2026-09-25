import { NextResponse } from "next/server";
import prisma from "../../lib/prisma";
import { decrypt, extractRepoName } from "../../lib/encryption";
import { getSessionUser, isGroupMember, unauthorized, forbidden } from "../../lib/apiAuth";
import { safeContentsPath } from "../../lib/githubFiles";

/** Enough of the tree to describe the project without flooding the prompt. */
const MAX_TREE_PATHS = 400;

/** Generated or vendored folders that say nothing about the project itself. */
const SKIPPED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage",
  "vendor", "target", "__pycache__", ".venv", "venv", ".turbo", ".cache",
]);

/**
 * Every file path in the repo, from one Git Trees request.
 *
 * This used to walk the Contents API one directory at a time with no limit,
 * so a large repo made hundreds of sequential requests — timing out or
 * burning through the owner's GitHub rate limit.
 */
async function fetchRepoFileTree(
  owner: string,
  repo: string,
  token: string,
): Promise<{ paths: string[]; truncated: boolean }> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
    {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    },
  );
  if (!res.ok) return { paths: [], truncated: false };

  const data = await res.json();
  if (!Array.isArray(data.tree)) return { paths: [], truncated: false };

  const paths: string[] = [];
  for (const item of data.tree) {
    if (item.type !== "blob" || typeof item.path !== "string") continue;
    if (item.path.split("/").some((seg: string) => SKIPPED_DIRS.has(seg))) continue;
    paths.push(item.path);
  }

  // GitHub itself truncates very large trees; either way the list is partial
  const truncated = Boolean(data.truncated) || paths.length > MAX_TREE_PATHS;
  return { paths: paths.slice(0, MAX_TREE_PATHS), truncated };
}

async function fetchFileContent(
  owner: string,
  repo: string,
  path: string,
  token: string,
): Promise<string> {
  const contentsPath = safeContentsPath(path);
  if (!contentsPath) return "";
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${contentsPath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!res.ok) return "";

  const data = await res.json();
  if (data.encoding === "base64" && data.content) {
    return Buffer.from(data.content, "base64").toString("utf-8");
  }
  return "";
}

// Groq retires models regularly — llama-3.3-70b-versatile was removed and
// started returning 404 model_not_found. Overridable via env so the next
// retirement is a config change, not a deploy.
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

export async function POST(req: Request) {
  try {
    const me = await getSessionUser();
    if (!me) return unauthorized();

    const { groupId } = await req.json();

    if (groupId && !(await isGroupMember(groupId, me.id))) {
      return forbidden("Not a member of this group");
    }

    if (!groupId) {
      return NextResponse.json(
        { error: "groupId is required" },
        { status: 400 },
      );
    }

    const groupDetails = await prisma.group.findUnique({
      where: { id: groupId },
      select: {
        githubRepo: true,
        ownerName: true,
        githubAccessToken: true,
      },
    });

    if (!groupDetails) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const { ownerName, githubAccessToken } = groupDetails;
    let githubRepo = extractRepoName(groupDetails.githubRepo);

    const decryptedToken = decrypt(githubAccessToken);

    const { paths: filePaths, truncated: treeTruncated } = await fetchRepoFileTree(
      ownerName,
      githubRepo,
      decryptedToken,
    );

    let projectContext = "## File Structure\n";
    projectContext += filePaths.join("\n") + "\n";
    if (treeTruncated) projectContext += "... (more files not shown)\n";
    projectContext += "\n";

    const importantFiles = [
      "package.json",
      "README.md",
      "requirements.txt",
      "Cargo.toml",
      "go.mod",
      "Gemfile",
      "Dockerfile",
      "docker-compose.yml",
      "Makefile",
      "setup.py",
      "pyproject.toml",
      "index.js",
      "index.ts",
      "app.js",
      "main.py",
      "main.go",
      "main.rs",
      "composer.json",
    ];

    // At most one request per known root file, fetched together rather than
    // one after another
    const present = importantFiles.filter((f) => filePaths.includes(f));
    const contents = await Promise.all(
      present.map((f) => fetchFileContent(ownerName, githubRepo, f, decryptedToken)),
    );
    present.forEach((impFile, i) => {
      const content = contents[i];
      if (!content) return;
      const truncated =
        content.length > 3000
          ? content.slice(0, 3000) + "\n... (truncated)"
          : content;
      projectContext += `### ${impFile}\n\`\`\`\n${truncated}\n\`\`\`\n\n`;
    });

    const titleMatch = githubRepo.match(/[^/]+$/);
    const projectName = titleMatch ? titleMatch[0] : githubRepo;

    const prompt = `You are a technical documentation expert. Generate a comprehensive README.md for a GitHub project called "${projectName}" based on the following file structure and key file contents.

${projectContext}

Generate a complete README.md with these sections (if relevant):
1. Project title and brief description
2. Features
3. Tech stack
4. Prerequisites
5. Installation/setup instructions
6. Usage
7. Project structure overview
8. Contributing guidelines
9. License

Use proper markdown formatting. Be concise but thorough. Return ONLY the README markdown content, no explanation.`;

    let readmeContent = "";

    if (process.env.GROQ_API_KEY) {
      const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 4096,
            temperature: 0.5,
          }),
        },
      );

      if (!response.ok) {
        const err = await response.text();
        console.error("Groq API error:", response.status, err);
        // Surface Groq's own reason. "AI generation failed" gave no clue that
        // the previous model had simply been decommissioned.
        let detail = "";
        try {
          detail = JSON.parse(err)?.error?.message ?? "";
        } catch {
          detail = err.slice(0, 200);
        }
        throw new Error(detail ? `AI generation failed: ${detail}` : "AI generation failed");
      }

      const data = await response.json();
      readmeContent = data.choices?.[0]?.message?.content || "";
    } else {
      readmeContent = `# ${projectName}

## Tech Stack
Based on the file structure: ${filePaths.length} files detected.

## Project Structure
\`\`\`
${filePaths.slice(0, 50).join("\n")}
${filePaths.length > 50 ? `\n... and ${filePaths.length - 50} more files` : ""}
\`\`\`

## Setup
1. Clone the repository
2. Install dependencies: \`npm install\` (or equivalent)
3. Configure environment variables
4. Run the project

## License
MIT
`;
    }

    return NextResponse.json(
      {
        content: readmeContent,
        fileName: "README.md",
        path: "README.md",
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error generating README:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate README",
      },
      { status: 500 },
    );
  }
}
