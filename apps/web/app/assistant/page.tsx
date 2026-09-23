"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { ArrowLeft, Sparkles } from "lucide-react";
import {
  AssistantComposer,
  AssistantMessageList,
  ChatActions,
} from "../components/AssistantChat";
import { useAssistantChat } from "../lib/useAssistantChat";

/**
 * Full-screen assistant chat. Phones land here after sending a message from
 * the home-page card; the conversation carries over via useAssistantChat.
 */
export default function AssistantPage() {
  const { status } = useSession();
  const router = useRouter();
  const chat = useAssistantChat({ resumePending: true });

  useEffect(() => {
    if (status === "unauthenticated") signIn();
  }, [status]);

  const goBack = () => {
    // Opened directly (no history in this tab) → go home instead of leaving the site
    if (window.history.length > 1) router.back();
    else router.push("/");
  };

  return (
    // Covers the site header (z-50) so the chat gets the whole screen
    <motion.div
      initial={{ opacity: 0, y: "25%" }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[60] flex flex-col h-[100dvh] bg-white dark:bg-gray-950"
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] border-b border-gray-200 dark:border-gray-800 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-gray-900/50 dark:to-gray-800/50">
        <button
          type="button"
          onClick={goBack}
          aria-label="Back"
          className="p-2 -ml-1 rounded-full text-gray-700 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Sparkles className="w-5 h-5 text-blue-500 shrink-0" />
        <h1 className="text-base font-semibold truncate">Ko-Lab Assistant</h1>
        <ChatActions chat={chat} />
      </header>

      {status !== "authenticated" ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <AssistantMessageList
            chat={chat}
            onPick={chat.send}
            size="lg"
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-3 w-full max-w-3xl mx-auto"
          />
          <div className="pb-[env(safe-area-inset-bottom)] bg-gray-50 dark:bg-gray-900/30">
            <div className="w-full max-w-3xl mx-auto">
              <AssistantComposer chat={chat} onSubmit={chat.send} size="lg" />
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
