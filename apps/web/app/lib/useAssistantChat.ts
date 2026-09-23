"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import toast from "react-hot-toast";
import {
  CREDITS_PER_CONVERSATION,
  type AssistantCredits,
} from "./assistantCredits";

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
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
    return raw ? { ...EMPTY, ...JSON.parse(raw), loading: false } : EMPTY;
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
      body: JSON.stringify({ messages, conversationId }),
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
        setState((s) => ({ ...s, conversationId: null, credits: null, pending: false }));
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
      messages: [...s.messages, { role: "assistant", content: data.response }],
      pending: false,
    }));
  } catch (error) {
    setState((s) => ({ ...s, pending: false }));
    toast.error(error instanceof Error ? error.message : "Unknown error");
  } finally {
    setState((s) => ({ ...s, loading: false }));
  }
}

/**
 * Shared assistant chat state. Pass `resumePending` on the full-page chat so a
 * refresh mid-request asks again instead of leaving the question unanswered.
 */
export function useAssistantChat({ resumePending = false } = {}) {
  const chat = useSyncExternalStore(subscribe, getState, () => EMPTY);

  const creditsTotal = chat.credits?.total ?? CREDITS_PER_CONVERSATION;
  const creditsRemaining = chat.credits?.remaining ?? CREDITS_PER_CONVERSATION;
  const outOfCredits = creditsRemaining <= 0;

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
    const noCredits = (s.credits?.remaining ?? CREDITS_PER_CONVERSATION) <= 0;
    if (!content || s.loading || noCredits) return false;

    setState((prev) => ({
      ...prev,
      messages: [...prev.messages, { role: "user", content }],
      pending: true,
    }));
    void requestReply();
    return true;
  }, []);

  const startNewChat = useCallback(() => setState(() => EMPTY), []);

  return {
    messages: chat.messages,
    loading: chat.loading,
    creditsTotal,
    creditsRemaining,
    outOfCredits,
    send,
    startNewChat,
  };
}
