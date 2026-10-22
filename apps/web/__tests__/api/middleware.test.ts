// @vitest-environment node
/**
 * The request guard in front of every route: flood limits, oversized bodies,
 * path traversal and unexpected content types.
 *
 * These are the app's own defences against abuse. Nothing else exercises them,
 * so a refactor could switch one off and every other test would still pass.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

type Middleware = (req: NextRequest) => Response;
let middleware: Middleware;

// The limiter keeps its counters in module memory, so each test gets a fresh copy
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  middleware = (await import("../../middleware")).middleware as unknown as Middleware;
});

interface Opts {
  method?: string;
  ip?: string;
  headers?: Record<string, string>;
}

function request(path: string, { method = "GET", ip = "203.0.113.7", headers = {} }: Opts = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "x-forwarded-for": ip, ...headers },
  });
}

const hit = (path: string, opts?: Opts) => middleware(request(path, opts));

/** Status of the last of `n` identical requests. */
function flood(n: number, path: string, opts?: Opts): number {
  let status = 0;
  for (let i = 0; i < n; i++) status = hit(path, opts).status;
  return status;
}

describe("request flood limits", () => {
  it("allows 120 API requests a minute from one address, then refuses", () => {
    expect(flood(120, "/api/my-groups")).toBe(200);

    const blocked = hit("/api/my-groups");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBe("60");
  });

  it("counts the limit across different API routes, not per route", () => {
    flood(60, "/api/my-groups");
    flood(60, "/api/notifications");
    expect(hit("/api/friends").status).toBe(429);
  });

  it("limits each address separately, so one flooder doesn't lock out others", () => {
    flood(121, "/api/my-groups", { ip: "198.51.100.1" });
    expect(hit("/api/my-groups", { ip: "198.51.100.1" }).status).toBe(429);
    expect(hit("/api/my-groups", { ip: "198.51.100.2" }).status).toBe(200);
  });

  it("uses the first address in a forwarded chain (the real client)", () => {
    flood(120, "/api/my-groups", { ip: "198.51.100.9, 10.0.0.1" });
    // Same client behind a different proxy hop is still the same client
    expect(hit("/api/my-groups", { ip: "198.51.100.9, 10.0.0.2" }).status).toBe(429);
  });

  it("lets the address back in once the minute has passed", () => {
    flood(121, "/api/my-groups");
    expect(hit("/api/my-groups").status).toBe(429);

    vi.advanceTimersByTime(60_001);
    expect(hit("/api/my-groups").status).toBe(200);
  });

  it("holds sign-in to 15 attempts a minute (password guessing)", () => {
    expect(flood(15, "/api/auth/signin")).toBe(200);
    expect(hit("/api/auth/signin").status).toBe(429);
  });

  it("applies the strict limit to sign-up and one-time-code requests too", () => {
    flood(15, "/api/auth/signup");
    // Shared budget: 15 across all three, so the next one anywhere is refused
    expect(hit("/api/auth/send-otp").status).toBe(429);
  });

  it("doesn't rate-limit ordinary page views", () => {
    expect(flood(300, "/chat-room")).toBe(200);
  });
});

describe("malformed and oversized requests", () => {
  it("blocks path traversal, including the encoded form", () => {
    // A plain "../" is resolved away by the URL parser before it gets here;
    // the encoded slash is how one survives.
    expect(hit("/api/files/..%2f..%2fetc/passwd").status).toBe(403);
    expect(hit("/api//internal").status).toBe(403);
  });

  it("rejects a body over 1 MB on ordinary routes", () => {
    const res = hit("/api/friends", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1000001" },
    });
    expect(res.status).toBe(413);
  });

  it("accepts a body of exactly 1 MB", () => {
    const res = hit("/api/friends", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1000000" },
    });
    expect(res.status).toBe(200);
  });

  it.each([
    "/api/modified-files",
    "/api/profile/avatar",
    "/api/groups/g1/image",
    "/api/workspace/g1/design-image",
  ])("gives the upload route %s room for a 5 MB file", (path) => {
    const res = hit(path, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "6000000" },
    });
    expect(res.status).toBe(200);
  });

  it("still caps upload routes, at 8 MB", () => {
    const res = hit("/api/profile/avatar", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": "8000001" },
    });
    expect(res.status).toBe(413);
  });

  it.each(["POST", "PUT", "PATCH"])("rejects a %s with an unexpected content type", (method) => {
    const res = hit("/api/friends", {
      method,
      headers: { "content-type": "text/plain", "content-length": "12" },
    });
    expect(res.status).toBe(415);
  });

  it("allows a mutation with no body (e.g. accepting a call)", () => {
    expect(hit("/api/calls/abc/accept", { method: "PUT" }).status).toBe(200);
  });

  it("leaves NextAuth's own form posts alone", () => {
    const res = hit("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "content-length": "40" },
    });
    expect(res.status).toBe(200);
  });
});

describe("CORS preflight", () => {
  it("answers OPTIONS with this site's origin only, never a wildcard", () => {
    const res = hit("/api/my-groups", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    const origin = res.headers.get("Access-Control-Allow-Origin");
    expect(origin).toBeTruthy();
    expect(origin).not.toBe("*");
  });
});
