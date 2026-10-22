import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// In-memory rate limit store.
// For multi-instance production deployments, replace with Upstash Redis:
// https://github.com/upstash/ratelimit
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

// Clean up old entries every 5 minutes to prevent memory leaks
setInterval(
  () => {
    const now = Date.now();
    for (const [key, val] of rateLimitStore.entries()) {
      if (now > val.resetAt) rateLimitStore.delete(key);
    }
  },
  5 * 60 * 1000,
);

// Requests one address may make to /api per minute. The browser tests drive
// dozens of pages from a single address and raise this for their own server;
// anything unset or invalid falls back to the default.
const DEFAULT_API_LIMIT = 120;
const configuredApiLimit = Number(process.env.API_RATE_LIMIT_PER_MINUTE);
const API_LIMIT =
  Number.isFinite(configuredApiLimit) && configuredApiLimit > 0
    ? configuredApiLimit
    : DEFAULT_API_LIMIT;

const UPLOAD_ROUTES = [
  /^\/api\/modified-files$/,
  /^\/api\/profile\/avatar$/,
  /^\/api\/groups\/[^/]+\/image$/,
  /^\/api\/workspace\/[^/]+\/design-image$/,
];

function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const real = request.headers.get("x-real-ip");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  if (real) return real.trim();
  return "unknown";
}

function isRateLimited(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return false; // not limited
  }

  if (entry.count >= limit) return true; // limited

  entry.count++;
  return false; // not limited
}

function rateLimitResponse(retryAfterSeconds = 60): NextResponse {
  return new NextResponse("Too many requests. Please try again later.", {
    status: 429,
    headers: {
      "Retry-After": String(retryAfterSeconds),
      "Content-Type": "text/plain",
    },
  });
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { method } = request;
  const ip = getClientIP(request);

  // ── CORS preflight ────────────────────────────────────────────────────────
  if (method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin":
          process.env.NEXTAUTH_URL || "http://localhost:3000",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // ── Block suspicious path traversal attempts ──────────────────────────────
  if (pathname.includes("..") || pathname.includes("//")) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  // ── Auth routes — strict limit (prevents brute-force + credential stuffing)
  // 15 requests per IP per minute
  if (
    pathname.startsWith("/api/auth/signin") ||
    pathname.startsWith("/api/auth/signup") ||
    pathname.startsWith("/api/auth/send-otp")
  ) {
    if (isRateLimited(`auth:${ip}`, 15, 60_000)) {
      return rateLimitResponse(60);
    }
  }

  // ── General API routes — 120 requests per IP per minute ──────────────────
  if (pathname.startsWith("/api/")) {
    if (isRateLimited(`api:${ip}`, API_LIMIT, 60_000)) {
      return rateLimitResponse(60);
    }
  }

  // ── Block requests with oversized bodies (basic DDoS mitigation) ──────────
  // Routes that take a file get more room: the editor saves text up to 5 MB and
  // images are capped at 5 MB by the routes themselves, so 1 MB here rejected
  // uploads those routes are meant to accept.
  const contentLength = request.headers.get("content-length");
  const maxBody = UPLOAD_ROUTES.some((r) => r.test(pathname)) ? 8_000_000 : 1_000_000;
  if (contentLength && parseInt(contentLength) > maxBody) {
    return new NextResponse("Payload too large", { status: 413 });
  }

  // ── Validate Content-Type on mutation requests that carry a body ──────────
  // Bodyless mutations (e.g. PUT /api/calls/:id/accept) are legitimate and
  // send no Content-Type, so only enforce the check when a body is present.
  if (
    (method === "POST" || method === "PUT" || method === "PATCH") &&
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/auth/") // NextAuth uses application/x-www-form-urlencoded internally
  ) {
    const contentLength = request.headers.get("content-length");
    const hasBody = contentLength !== null && contentLength !== "0";
    const contentType = request.headers.get("content-type") || "";
    if (
      hasBody &&
      !contentType.includes("application/json") &&
      !contentType.includes("multipart/form-data")
    ) {
      return new NextResponse("Unsupported Media Type", { status: 415 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Apply to all API routes and auth routes
    "/api/:path*",
    // Exclude Next.js internals and static files
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
