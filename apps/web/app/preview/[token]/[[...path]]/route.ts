import { NextResponse } from "next/server";
import prisma from "../../../lib/prisma";
import { getSessionUser } from "../../../lib/apiAuth";
import { contentTypeFor, readSnapshotFile } from "../../../lib/livePreview";

// Serves "Make it live" sites. The code is group members' own, running on our
// origin, so every response is sandboxed (CSP `sandbox` without
// allow-same-origin): the page gets an opaque origin and can't read the app's
// cookies, storage or API responses. The flip side is that the site's own
// localStorage/cookies don't work in a preview.
const SANDBOX_CSP = [
  "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads",
  "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'",
].join("; ");

const baseHeaders = {
  "Content-Security-Policy": SANDBOX_CSP,
  "X-Content-Type-Options": "nosniff",
  // The token in the URL is the credential. Keep it out of Referer headers
  // sent to CDNs and analytics the site loads.
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  // Saves with auto-update on should show on the next reload
  "Cache-Control": "no-store",
};

function notice(status: number, title: string, body: string): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#0b0f19;color:#e5e7eb}
main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#9ca3af;line-height:1.5;margin:0}</style>
</head><body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { ...baseHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(
  req: Request,
  { params }: { params: { token: string; path?: string[] } },
) {
  const { token } = params;
  const preview = await prisma.livePreview.findFirst({
    where: { OR: [{ token }, { shareToken: token }] },
  });
  if (!preview) {
    return notice(404, "Site not found", "This link doesn't point to a live site. It may have been taken down.");
  }

  const isShare = preview.shareToken === token;
  const expiresAt = isShare ? preview.shareExpiresAt : preview.expiresAt;
  if (!expiresAt || expiresAt <= new Date()) {
    return notice(
      410,
      "This live site has expired",
      isShare
        ? "The share link has run out. Ask the author for a new one."
        : "Live sites come down automatically. Open the file in the Ko-lab editor and click Make it live to run it again.",
    );
  }

  const segments = params.path ?? [];
  if (segments.length === 0) {
    // Relative links (style.css) only resolve under a real file path, and Next
    // strips trailing slashes, so send the bare link to index.html.
    return NextResponse.redirect(new URL(`/preview/${token}/index.html`, req.url), 307);
  }
  const sitePath = segments.join("/");

  // Pages of a private link are for the author only. Subresources can't be
  // checked the same way (the sandboxed page sends no cookies), so they rest
  // on the unguessable token.
  if (!isShare && contentTypeFor(sitePath).startsWith("text/html")) {
    const me = await getSessionUser();
    if (me?.id !== preview.userId) {
      return notice(
        403,
        "This live site is private",
        "Only its author can open it. They can create a share link from the editor.",
      );
    }
  }

  const file = await readSnapshotFile(preview.id, sitePath);
  if (file) {
    return new Response(Buffer.from(file), {
      headers: { ...baseHeaders, "Content-Type": contentTypeFor(sitePath) },
    });
  }

  // Pretty URLs: /about → about.html or about/index.html
  if (!/\.[^/]+$/.test(sitePath)) {
    for (const candidate of [`${sitePath}.html`, `${sitePath}/index.html`]) {
      if (await readSnapshotFile(preview.id, candidate)) {
        return NextResponse.redirect(new URL(`/preview/${token}/${candidate}`, req.url), 307);
      }
    }
  }

  const custom404 = await readSnapshotFile(preview.id, "404.html");
  if (custom404) {
    return new Response(Buffer.from(custom404), {
      status: 404,
      headers: { ...baseHeaders, "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return notice(404, "Page not found", `${sitePath.replace(/[<>&"]/g, "")} isn't part of this site.`);
}
