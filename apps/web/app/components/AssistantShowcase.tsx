"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { Sparkles, GitPullRequest, CircleDot, Phone } from "lucide-react";

/**
 * Landing-page showcase for the ko-lab assistant.
 *
 * A self-playing mock conversation rather than a screenshot: it demonstrates
 * the "what did I miss?" answer, which is the feature that distinguishes the
 * assistant from a menu — the join across chat, change requests and calls that
 * no single tool can answer. Rendered in markup so it stays sharp on any
 * display, themes with the rest of the page, and needs no asset pipeline.
 *
 * The numbers are illustrative sample content, labelled as such in the UI so a
 * visitor doesn't read it as their own data.
 */

/** One line of the assistant's answer, revealed in sequence. */
const DIGEST = [
  {
    icon: CircleDot,
    tone: "text-blue-500",
    text: "23 messages in Anime Website Group — Priya asked twice about the API contract, still unanswered.",
  },
  {
    icon: GitPullRequest,
    tone: "text-purple-500",
    text: "1 change request opened by Rahul, 1 approved. Yours is still awaiting review (5 days).",
  },
  {
    icon: Phone,
    tone: "text-indigo-500",
    text: "You missed a 30-minute group call on Tuesday. Two tasks were created during it.",
  },
];

/** Delay before the answer starts, so the question reads first. */
const ANSWER_DELAY_MS = 700;
/** Gap between each revealed digest line. */
const LINE_STAGGER_MS = 500;

export default function AssistantShowcase() {
  const sectionRef = useRef<HTMLElement>(null);
  // Play once when scrolled into view rather than on mount, so the animation
  // isn't already finished by the time a visitor reaches this section.
  const inView = useInView(sectionRef, { once: true, amount: 0.4 });
  const [revealed, setRevealed] = useState(0);

  useEffect(() => {
    if (!inView) return;

    const timers = DIGEST.map((_, i) =>
      setTimeout(() => setRevealed(i + 1), ANSWER_DELAY_MS + i * LINE_STAGGER_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [inView]);

  const thinking = inView && revealed === 0;

  return (
    <section
      ref={sectionRef}
      className="px-4 sm:px-6 lg:px-8 pb-12 sm:pb-16 max-w-5xl mx-auto"
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.6 }}
        className="rounded-xl bg-white dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2">
          {/* ── Pitch ─────────────────────────────────────────────────── */}
          <div className="p-6 sm:p-8 flex flex-col justify-center">
            <span className="inline-flex items-center gap-1.5 self-start px-2.5 py-1 mb-4 rounded-full text-[11px] font-semibold bg-gradient-to-r from-green-500/10 to-emerald-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
              <Sparkles className="w-3 h-3" />
              Now available
            </span>

            <h2 className="text-xl sm:text-2xl font-bold mb-3">
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-purple-600">
                Ask your workspace
              </span>
            </h2>

            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed mb-4">
              Your code, reviews, tasks and calls all live in one place — so one
              question can cover them all. No dashboard-hopping to find out
              where a project actually stands.
            </p>

            <ul className="space-y-2">
              {[
                "Catch up on everything you missed",
                "Find out what's really blocking a task",
                "Spot drafts that have gone stale",
              ].map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400"
                >
                  <span
                    aria-hidden
                    className="mt-1.5 w-1 h-1 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 shrink-0"
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* ── Mock conversation ─────────────────────────────────────── */}
          <div className="p-6 sm:p-8 bg-gray-50 dark:bg-gray-900/50 border-t lg:border-t-0 lg:border-l border-gray-200 dark:border-gray-700">
            {/* Labelled so sample content is never mistaken for real data. */}
            <p className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-3">
              Example
            </p>

            {/* The user's question */}
            <div className="flex justify-end mb-3">
              <div className="max-w-[85%] px-3.5 py-2 rounded-2xl rounded-br-md bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-medium shadow-sm">
                What did I miss since Tuesday?
              </div>
            </div>

            {/* The assistant's answer */}
            <div className="flex gap-2.5">
              <div className="shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-sm">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>

              <div className="flex-1 min-w-0">
                {thinking ? (
                  <div
                    className="flex items-center gap-1 h-7"
                    role="status"
                    aria-label="Assistant is thinking"
                  >
                    {[0, 1, 2].map((i) => (
                      <motion.span
                        key={i}
                        className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500"
                        animate={{ opacity: [0.3, 1, 0.3] }}
                        transition={{
                          duration: 1.2,
                          repeat: Infinity,
                          delay: i * 0.2,
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {DIGEST.slice(0, revealed).map(
                      ({ icon: Icon, tone, text }) => (
                        <motion.div
                          key={text}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.35 }}
                          className="flex items-start gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm"
                        >
                          <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${tone}`} />
                          <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                            {text}
                          </p>
                        </motion.div>
                      ),
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
