"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FixSearchResult } from "../../../../lib/findFix";

export interface FindFixRequest {
  error: string;
  language?: string;
  snippet?: string;
  source: "lint" | "run" | "manual";
}

export interface FindFixResponse {
  query: string;
  results: FixSearchResult[];
  aiFix: string | null;
  cached: boolean;
  searchLimited: boolean;
  searchFailed: boolean;
  remaining: number;
}

export type FindFixState =
  | { status: "idle" }
  | { status: "loading"; request: FindFixRequest }
  | { status: "done"; request: FindFixRequest; data: FindFixResponse }
  | { status: "error"; request: FindFixRequest; message: string };

function describeFailure(status: number, body: { error?: string; retryAfter?: number } | null): string {
  switch (status) {
    case 401:
      return "Sign in to search for fixes.";
    case 429: {
      const mins = Math.max(1, Math.ceil((body?.retryAfter ?? 60) / 60));
      return `You've used all your fix searches for now. Try again in about ${mins} min.`;
    }
    case 503:
      return "Fix search isn't set up on this server yet.";
    case 504:
      return "The search took too long. Please try again.";
    default:
      return body?.error || "Couldn't find a fix right now. Please try again.";
  }
}

export function useFindFix() {
  const [state, setState] = useState<FindFixState>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setState({ status: "idle" });
  }, []);

  const findFix = useCallback(async (request: FindFixRequest) => {
    // A new search replaces the one in flight
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setState({ status: "loading", request });

    try {
      const res = await fetch("/api/editor/find-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: ac.signal,
      });
      const body = await res.json().catch(() => null);
      if (ac.signal.aborted) return;
      if (!res.ok) {
        setState({ status: "error", request, message: describeFailure(res.status, body) });
        return;
      }
      setState({ status: "done", request, data: body as FindFixResponse });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState({ status: "error", request, message: "Network error. Check your connection and retry." });
    } finally {
      if (controller.current === ac) controller.current = null;
    }
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  return { state, findFix, cancel };
}
