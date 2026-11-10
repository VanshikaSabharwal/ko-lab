"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import toast from "react-hot-toast";
import {
  DAILY_CREDITS,
  type AssistantCredits,
} from "./assistantCredits";

export type ChatActionStatus =
  | "PENDING"
  | "WORKING"
  | "EXECUTED"
  | "CANCELLED"
  | "FAILED"
  | "EXPIRED";

/** A change the assistant proposed, shown as a card for the user to confirm. */
export interface ChatAction {
  id: string;
  preview: { title: string; details: { label: string; value: string }[] };
  status: ChatActionStatus;
  /** Outcome shown under the card once it's been decided. */
  outcome?: string;
}

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
  actions?: ChatAction[];
}

const OUTCOME_NOTE: Partial<Record<ChatActionStatus, string>> = {
  EXECUTED: "confirmed and applied",
  CANCELLED: "cancelled by the user",
  FAILED: "failed",
  EXPIRED: "expired without being confirmed",
  PENDING: "not confirmed yet",
};

/**
 * What the server sees of a message. Proposals are decided after the reply,
 * so without this note the model would think every change is still waiting.
 */
function forServer(m: AssistantMessage) {
  const notes = (m.actions ?? [])
    .map((a) => {
      const note = OUTCOME_NOTE[a.status];
      return note && `[${a.preview.title}: ${note}]`;
    })
    .filter(Boolean);
  return {
    role: m.role,
    content: notes.length ? `${m.content}\n\n${notes.join("\n")}` : m.content,
  };
}

interface ChatState {
  messages: AssistantMessage[];
  conversationId: string | null;
  credits: AssistantCredits | null;
  // The last user message is still waiting for a reply
  pending: boolean;
  loading: boolean;
}

// The home-page card and /assistant share one chat, so it lives at module
// scope (survives client-side navigation) and is mirrored to sessionStorage
// (survives a refresh of this tab).
const STORAGE_KEY = "ko-lab:assistant-chat";
const EMPTY: ChatState = {
  messages: [],
  conversationId: null,
  credits: null,
  pending: false,
  loading: false,
};

let state: ChatState | null = null;
const listeners = new Set<() => void>();

function readStorage(): ChatState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    // A request can't survive a reload, so `loading` always starts false
    if (!raw) return EMPTY;
    const saved: ChatState = { ...EMPTY, ...JSON.parse(raw), loading: false };
    // Same for a confirm that was in flight: offer the buttons again (the
    // server answers "already handled" if it went through)
    saved.messages = saved.messages.map((m) =>
      m.actions?.some((a) => a.status === "WORKING")
        ? {
            ...m,
            actions: m.actions.map((a) =>
              a.status === "WORKING" ? { ...a, status: "PENDING" as const } : a,
            ),
          }
        : m,
    );
    return saved;
  } catch {
    return EMPTY;
  }
}

function getState(): ChatState {
  state ??= readStorage();
  return state;
}

function setState(update: (s: ChatState) => ChatState) {
  state = update(getState());
  try {
    const { loading: _loading, ...persisted } = state;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Storage unavailable (private mode etc.) — the in-memory chat still works
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function requestReply() {
  const { messages, conversationId } = getState();
  setState((s) => ({ ...s, loading: true }));

  try {
    const response = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: messages.map(forServer),
        conversationId,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      if (data.code === "OUT_OF_CREDITS") {
        // Not charged and not answered, so drop the message we just showed
        setState((s) => ({
          ...s,
          messages: s.messages.slice(0, -1),
          conversationId: data.conversationId,
          credits: data.credits,
          pending: false,
        }));
      } else if (response.status === 404) {
        // Conversation no longer exists server-side; the next send starts fresh
        setState((s) => ({ ...s, conversationId: null, pending: false }));
      } else {
        setState((s) => ({ ...s, pending: false }));
      }
      toast.error(data.error || "Failed to get response");
      return;
    }

    setState((s) => ({
      ...s,
      conversationId: data.conversationId,
      credits: data.credits,
      messages: [
        ...s.messages,
        {
          role: "assistant",
          content: data.response,
          ...(data.actions?.length && {
            actions: (data.actions as ChatAction[]).map((a) => ({
              id: a.id,
              preview: a.preview,
              status: "PENDING" as const,
            })),
          }),
        },
      ],
      pending: false,
    }));
  } catch (error) {
    setState((s) => ({ ...s, pending: false }));
    toast.error(error instanceof Error ? error.message : "Unknown error");
  } finally {
    setState((s) => ({ ...s, loading: false }));
  }
}

function updateAction(id: string, update: Partial<ChatAction>) {
  setState((s) => ({
    ...s,
    messages: s.messages.map((m) =>
      m.actions?.some((a) => a.id === id)
        ? { ...m, actions: m.actions.map((a) => (a.id === id ? { ...a, ...update } : a)) }
        : m,
    ),
  }));
}

async function decideAction(id: string, decision: "confirm" | "cancel") {
  updateAction(id, { status: "WORKING" });
  try {
    const res = await fetch(`/api/assistant/actions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const data = await res.json();
    if (res.ok) {
      updateAction(id, { status: data.status, outcome: data.message });
      if (data.status === "EXECUTED") toast.success(data.message);
      return;
    }
    // 409 means another tab already decided it; show what we know
    const status: ChatActionStatus =
      data.status === "EXPIRED" || data.status === "FAILED" || data.status === "EXECUTED" ||
      data.status === "CANCELLED"
        ? data.status
        : "FAILED";
    updateAction(id, { status, outcome: data.error });
    toast.error(data.error || "Couldn't apply that change");
  } catch (error) {
    // The request may or may not have reached the server; let them retry
    updateAction(id, { status: "PENDING" });
    toast.error(error instanceof Error ? error.message : "Network error");
  }
}

// Stored credits can be from an earlier day or another tab, so ask the server
// once per page load.
let creditsRefreshed = false;

async function refreshCredits() {
  if (creditsRefreshed) return;
  creditsRefreshed = true;
  try {
    const res = await fetch("/api/assistant");
    if (!res.ok) return;
    const data = await res.json();
    if (data.credits) setState((s) => ({ ...s, credits: data.credits }));
  } catch {
    // The next reply carries the count anyway
  }
}

/**
 * Shared assistant chat state. Pass `resumePending` on the full-page chat so a
 * refresh mid-request asks again instead of leaving the question unanswered.
 */
export function useAssistantChat({ resumePending = false } = {}) {
  const chat = useSyncExternalStore(subscribe, getState, () => EMPTY);

  const creditsTotal = chat.credits?.total ?? DAILY_CREDITS;
  const creditsRemaining = chat.credits?.remaining ?? DAILY_CREDITS;
  const outOfCredits = creditsRemaining <= 0;

  useEffect(() => {
    void refreshCredits();
  }, []);

  useEffect(() => {
    if (!resumePending) return;
    const s = getState();
    const last = s.messages[s.messages.length - 1];
    if (s.pending && !s.loading && last?.role === "user") {
      void requestReply();
    }
  }, [resumePending]);

  /** Returns false when the message wasn't sent (empty, busy, or no credits). */
  const send = useCallback((text: string) => {
    const content = text.trim();
    const s = getState();
    const noCredits = (s.credits?.remaining ?? DAILY_CREDITS) <= 0;
    if (!content || s.loading || noCredits) return false;

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, { role: "user", content }],
      pending: true,
    }));
    void requestReply();
    return true;
  }, []);

  // The allowance is per day, not per chat, so it carries over
  const startNewChat = useCallback(
    () => setState((s) => ({ ...EMPTY, credits: s.credits })),
    [],
  );

  const confirmAction = useCallback((id: string) => decideAction(id, "confirm"), []);
  const cancelAction = useCallback((id: string) => decideAction(id, "cancel"), []);

  return {
    messages: chat.messages,
    loading: chat.loading,
    confirmAction,
    cancelAction,
    creditsTotal,
    creditsRemaining,
    outOfCredits,
    send,
    startNewChat,
  };
}
