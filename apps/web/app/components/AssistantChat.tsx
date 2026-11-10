"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import {
  ArrowRight,
  Loader2,
  Send,
  Sparkles,
  Mic,
  MicOff,
  Coins,
  Plus,
  Check,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import AssistantMarkdown from "./AssistantMarkdown";
import {
  useAssistantChat,
  type AssistantMessage,
  type ChatAction,
} from "../lib/useAssistantChat";

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

const QUICK_PROMPTS = [
  "What did I miss?",
  "Show my groups",
  "My open tasks",
  "Recent changes",
];

// Below Tailwind's `md` breakpoint the chat moves to its own page
const PHONE_QUERY = "(max-width: 767px)";

type Size = "sm" | "lg";
type Chat = ReturnType<typeof useAssistantChat>;

function useSpeechInput(onTranscript: (text: string) => void) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
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
      onTranscriptRef.current(transcript);
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

  const toggle = () => {
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

  return { isListening, toggle };
}

export function ChatActions({ chat }: { chat: Chat }) {
  const { creditsRemaining, creditsTotal, outOfCredits } = chat;
  return (
    <div className="ml-auto flex items-center gap-2">
      <span
        title={`Each message you send uses 1 credit. You get ${creditsTotal} a day; they reset at midnight UTC.`}
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
          outOfCredits
            ? "border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
            : creditsRemaining <= 3
              ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
              : "border-gray-200 bg-white/70 text-gray-600 dark:border-gray-600 dark:bg-gray-800/60 dark:text-gray-300"
        }`}
      >
        <Coins className="w-3 h-3" />
        {creditsRemaining}/{creditsTotal} credits today
      </span>
      {chat.messages.length > 0 && (
        <button
          type="button"
          onClick={chat.startNewChat}
          disabled={chat.loading}
          className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-gray-600 hover:text-gray-900 hover:border-blue-400 dark:border-gray-600 dark:bg-gray-800/60 dark:text-gray-300 dark:hover:text-white disabled:opacity-50 transition"
        >
          <Plus className="w-3 h-3" />
          New chat
        </button>
      )}
    </div>
  );
}

function QuickPrompts({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="space-y-4">
      <p className="text-center text-gray-500 dark:text-gray-400 text-sm font-medium">
        Quick questions:
      </p>
      <div className="grid grid-cols-2 gap-3">
        {QUICK_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            className="px-3 py-2.5 text-sm bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition font-medium"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

const ACTION_STATUS_LABEL: Record<ChatAction["status"], string> = {
  PENDING: "Needs your OK",
  WORKING: "Applying…",
  EXECUTED: "Done",
  CANCELLED: "Cancelled",
  FAILED: "Failed",
  EXPIRED: "Expired",
};

/** A change the assistant prepared; nothing happens until it's confirmed. */
function ActionCard({ action, chat }: { action: ChatAction; chat: Chat }) {
  const { preview, status, outcome } = action;
  const tone =
    status === "EXECUTED"
      ? "text-green-700 dark:text-green-300"
      : status === "FAILED" || status === "EXPIRED"
        ? "text-red-700 dark:text-red-300"
        : "text-gray-500 dark:text-gray-400";

  return (
    <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-gray-900 dark:text-gray-100">{preview.title}</p>
        <span className={`shrink-0 text-[11px] font-medium ${tone}`}>
          {ACTION_STATUS_LABEL[status]}
        </span>
      </div>
      {preview.details.length > 0 && (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {preview.details.map((d) => (
            <React.Fragment key={d.label}>
              <dt className="text-gray-500 dark:text-gray-400">{d.label}</dt>
              <dd className="text-gray-800 dark:text-gray-200 break-words">{d.value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {outcome && status !== "PENDING" && (
        <p className={`mt-2 text-xs ${tone}`}>{outcome}</p>
      )}
      {(status === "PENDING" || status === "WORKING") && (
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={() => chat.confirmAction(action.id)}
            disabled={status === "WORKING"}
            className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {status === "WORKING" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Check className="w-3 h-3" />
            )}
            Confirm
          </button>
          <button
            type="button"
            onClick={() => chat.cancelAction(action.id)}
            disabled={status === "WORKING"}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 dark:border-gray-600 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 transition"
          >
            <X className="w-3 h-3" />
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export function AssistantMessageList({
  chat,
  onPick,
  size = "sm",
  className = "",
}: {
  chat: Chat;
  onPick: (prompt: string) => void;
  size?: Size;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const text = size === "lg" ? "text-[15px]" : "text-sm";

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [chat.messages, chat.loading]);

  return (
    <div ref={scrollRef} className={className}>
      {chat.messages.length === 0 && !chat.loading ? (
        <div className="mt-6">
          <QuickPrompts onPick={onPick} />
        </div>
      ) : (
        chat.messages.map((msg: AssistantMessage, i: number) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`px-3.5 py-2.5 rounded-xl ${text} ${
                msg.role === "user"
                  ? "max-w-[75%] bg-blue-600 text-white rounded-br-none whitespace-pre-wrap"
                  : "max-w-[85%] bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-bl-none"
              }`}
            >
              {msg.role === "assistant" ? (
                <>
                  <AssistantMarkdown content={msg.content} />
                  {msg.actions?.map((action) => (
                    <ActionCard key={action.id} action={action} chat={chat} />
                  ))}
                </>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))
      )}
      {chat.loading && (
        <div className="flex justify-start">
          <div className="px-3.5 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-gray-600 dark:text-gray-400" />
            <span className={`${text} text-gray-600 dark:text-gray-400`}>
              Thinking...
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Input row — replaced by a notice once today's credits are spent. */
export function AssistantComposer({
  chat,
  onSubmit,
  size = "sm",
  autoFocus = false,
}: {
  chat: Chat;
  onSubmit: (text: string) => boolean;
  size?: Size;
  autoFocus?: boolean;
}) {
  const [input, setInput] = useState("");
  const { isListening, toggle } = useSpeechInput(setInput);
  // 16px on the full page stops iOS Safari zooming into the input on focus
  const text = size === "lg" ? "text-base" : "text-sm";
  const icon = "w-4 h-4";

  if (chat.outOfCredits) {
    return (
      <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30">
        <p className="text-xs text-gray-600 dark:text-gray-400">
          You&apos;ve used all {chat.creditsTotal} of today&apos;s credits. They reset at midnight UTC.
        </p>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (onSubmit(input)) setInput("");
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30"
    >
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          autoFocus={autoFocus}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            isListening ? "Listening..." : "Ask me anything or use voice..."
          }
          disabled={chat.loading}
          className={`flex-1 min-w-0 px-3.5 py-2.5 ${text} rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 transition`}
        />
        <button
          type="button"
          onClick={toggle}
          disabled={chat.loading}
          className={`px-3.5 py-2.5 rounded-lg transition flex items-center justify-center ${
            isListening
              ? "bg-red-500 hover:bg-red-600 text-white"
              : "bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
          } disabled:opacity-50`}
          title="Click to start/stop speaking"
        >
          {isListening ? <MicOff className={icon} /> : <Mic className={icon} />}
        </button>
        <button
          type="submit"
          disabled={chat.loading || !input.trim()}
          className="px-3.5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition flex items-center justify-center"
        >
          <Send className={icon} />
        </button>
      </div>
    </form>
  );
}

/**
 * Home-page assistant card.
 * Shown to everyone; guests are asked to log in when they try to send.
 * On phones it has no scrolling area of its own (so swipes over it scroll the
 * page) and sending a message opens the full-screen chat at /assistant.
 */
export default function AssistantChat() {
  const { data: session } = useSession();
  const router = useRouter();
  const chat = useAssistantChat();

  const submit = (text: string) => {
    if (!session?.user) {
      if (text.trim()) {
        toast.error(
          (t) => (
            <span className="flex items-center gap-3">
              You need to log in to chat with the assistant.
              <button
                type="button"
                onClick={() => {
                  toast.dismiss(t.id);
                  signIn();
                }}
                className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Log in
              </button>
            </span>
          ),
          { id: "assistant-login" },
        );
      }
      return false;
    }
    if (!chat.send(text)) return false;
    if (window.matchMedia(PHONE_QUERY).matches) router.push("/assistant");
    return true;
  };

  return (
    // Fixed height on desktop: the parents are auto-height, so without a cap
    // the card grows with every message and the list below never scrolls.
    <div className="flex flex-col md:h-[640px] md:max-h-[85vh] bg-white dark:bg-gray-800/40 backdrop-blur border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-gray-900/50 dark:to-gray-800/50">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-500" />
          <h3 className="text-lg font-semibold">Ko-Lab Assistant</h3>
          <ChatActions chat={chat} />
        </div>
        <p className="text-[15px] text-gray-600 dark:text-gray-400 mt-2">
          Ask about your groups and tasks, or have me make changes for you to confirm
        </p>
      </div>

      {/* Phone: compact body, nothing scrolls inside the card */}
      <div className="md:hidden p-4">
        {chat.messages.length > 0 ? (
          <Link
            href="/assistant"
            className="flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium rounded-lg bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300"
          >
            <span>
              {chat.loading ? "Thinking… open chat" : "Continue chat"}
              <span className="ml-1 font-normal opacity-75">
                · {chat.messages.length} message{chat.messages.length === 1 ? "" : "s"}
              </span>
            </span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        ) : (
          <QuickPrompts onPick={submit} />
        )}
      </div>

      {/* Desktop: messages scroll inside the card */}
      <AssistantMessageList
        chat={chat}
        onPick={submit}
        className="hidden md:block flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-3"
      />

      <AssistantComposer chat={chat} onSubmit={submit} />
    </div>
  );
}
