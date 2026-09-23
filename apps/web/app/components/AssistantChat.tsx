"use client";

import React, { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  Loader2,
  Send,
  Sparkles,
  Mic,
  MicOff,
  Coins,
  Plus,
} from "lucide-react";
import toast from "react-hot-toast";
import AssistantMarkdown from "./AssistantMarkdown";
import {
  CREDITS_PER_CONVERSATION,
  type AssistantCredits,
} from "../lib/assistantCredits";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface MessageParam {
  role: "user" | "assistant";
  content: string;
}

// Speech Recognition API types
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
  length: number;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
    onend: ((this: SpeechRecognition, ev: Event) => any) | null;
    onresult:
      | ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any)
      | null;
    onerror: ((this: SpeechRecognition, ev: Event) => any) | null;
    start(): void;
    stop(): void;
    abort(): void;
  }
}

const SPEECH_ERRORS: Record<string, string> = {
  "not-allowed":
    "Microphone access is blocked. Allow it from the address bar and try again.",
  "service-not-allowed":
    "Microphone access is blocked. Allow it from the address bar and try again.",
  "audio-capture": "No microphone found. Check that one is connected.",
  "no-speech": "Didn't catch that. Try speaking again.",
  network:
    "Speech recognition needs an internet connection (this browser may not support it).",
};

/**
 * Live assistant chat component.
 * Shows only for authenticated users; guests see the static AssistantShowcase.
 * Integrated with the Groq backend via /api/assistant.
 */
export default function AssistantChat() {
  const { data: session } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  // Assigned by the server on the first message; credits come back with every reply
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [credits, setCredits] = useState<AssistantCredits | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    // Initialize speech recognition
    const SpeechRecognition =
      window.SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition: SpeechRecognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(
        { length: event.results.length },
        (_, i) => event.results[i]?.[0]?.transcript ?? "",
      ).join("");
      setInput(transcript);
    };

    recognition.onerror = (event: Event) => {
      const code = (event as Event & { error?: string }).error;
      setIsListening(false);
      // "aborted" fires when we stop it ourselves; "no-speech" is just silence
      if (code === "aborted") return;
      toast.error(
        SPEECH_ERRORS[code ?? ""] ?? `Speech recognition failed (${code})`,
      );
    };

    recognitionRef.current = recognition;
    return () => recognition.abort();
  }, []);

  useEffect(() => {
    // Auto-scroll to bottom
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  // Only render for authenticated users (after all hooks, so hook order is stable)
  if (!session?.user) {
    return null;
  }

  const handleVoiceClick = () => {
    if (!recognitionRef.current) {
      toast.error("Speech recognition not supported");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
      } catch {
        // start() throws if a previous session hasn't fully ended yet
        recognitionRef.current.abort();
        setIsListening(false);
      }
    }
  };

  const creditsRemaining = credits?.remaining ?? CREDITS_PER_CONVERSATION;
  const creditsTotal = credits?.total ?? CREDITS_PER_CONVERSATION;
  const outOfCredits = creditsRemaining <= 0;

  const startNewChat = () => {
    setMessages([]);
    setConversationId(null);
    setCredits(null);
    setInput("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading || outOfCredits) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);

    try {
      const messagesToSend: MessageParam[] = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: userMessage },
      ];

      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: messagesToSend, conversationId }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.code === "OUT_OF_CREDITS") {
          // Not charged and not answered, so drop the message we just showed
          setMessages((prev) => prev.slice(0, -1));
          setConversationId(data.conversationId);
          setCredits(data.credits);
        } else if (response.status === 404) {
          // Conversation no longer exists server-side; the next send starts fresh
          setConversationId(null);
          setCredits(null);
        }
        toast.error(data.error || "Failed to get response");
        return;
      }

      setConversationId(data.conversationId);
      setCredits(data.credits);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    // Fixed height: the parents are auto-height, so without a cap the card
    // grows with every message and the list below never scrolls.
    <div className="flex flex-col h-[560px] max-h-[80vh] bg-white dark:bg-gray-800/40 backdrop-blur border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-gray-900/50 dark:to-gray-800/50">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-500" />
          <h3 className="text-base font-semibold">Ko-Lab Assistant</h3>
          <div className="ml-auto flex items-center gap-2">
            <span
              title="Each message you send uses 1 credit. Start a new chat for a fresh set."
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                outOfCredits
                  ? "border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
                  : creditsRemaining <= 3
                    ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                    : "border-gray-200 bg-white/70 text-gray-600 dark:border-gray-600 dark:bg-gray-800/60 dark:text-gray-300"
              }`}
            >
              <Coins className="w-3 h-3" />
              {creditsRemaining}/{creditsTotal} credits
            </span>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={startNewChat}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:text-gray-900 hover:border-blue-400 dark:border-gray-600 dark:bg-gray-800/60 dark:text-gray-300 dark:hover:text-white disabled:opacity-50 transition"
              >
                <Plus className="w-3 h-3" />
                New chat
              </button>
            )}
          </div>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
          Ask about your groups, tasks, or recent changes
        </p>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3"
      >
        {messages.length === 0 ? (
          <div className="space-y-4">
            <p className="text-center text-gray-500 dark:text-gray-400 text-sm font-medium mt-6">
              Quick questions:
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                "What did I miss?",
                "Show my groups",
                "My open tasks",
                "Recent changes",
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => {
                    setInput(prompt);
                    setTimeout(() => {
                      const form = document.querySelector(
                        "form[class*='border-t']",
                      ) as HTMLFormElement;
                      form?.dispatchEvent(
                        new Event("submit", { bubbles: true }),
                      );
                    }, 0);
                  }}
                  className="px-3 py-2.5 text-sm bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition font-medium"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`px-3 py-2 rounded-lg text-xs ${
                  msg.role === "user"
                    ? "max-w-[75%] bg-blue-600 text-white rounded-br-none whitespace-pre-wrap"
                    : "max-w-[85%] bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-none"
                }`}
              >
                {msg.role === "assistant" ? (
                  <AssistantMarkdown content={msg.content} />
                ) : (
                  msg.content
                )}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin text-gray-600 dark:text-gray-400" />
              <span className="text-xs text-gray-600 dark:text-gray-400">
                Thinking...
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Input — replaced by a restart prompt once the credits are spent */}
      {outOfCredits ? (
        <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            You&apos;ve used all {creditsTotal} credits in this chat.
          </p>
          <button
            type="button"
            onClick={startNewChat}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:opacity-90 transition"
          >
            <Plus className="w-3 h-3" />
            New chat
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30"
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                isListening ? "Listening..." : "Ask me anything or use voice..."
              }
              disabled={loading}
              className="flex-1 px-3 py-2 text-xs rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition"
            />
            <button
              type="button"
              onClick={handleVoiceClick}
              disabled={loading}
              className={`px-3 py-2 rounded-lg transition flex items-center justify-center ${
                isListening
                  ? "bg-red-500 hover:bg-red-600 text-white"
                  : "bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
              } disabled:opacity-50`}
              title="Click to start/stop speaking"
            >
              {isListening ? (
                <MicOff className="w-3 h-3" />
              ) : (
                <Mic className="w-3 h-3" />
              )}
            </button>
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-3 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition flex items-center justify-center"
            >
              <Send className="w-3 h-3" />
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
