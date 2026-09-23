"use client";

import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Table cells whose whole text is a PlanningPriority value render as a pill
const PRIORITY_STYLES: Record<string, string> = {
  HIGH: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  MEDIUM: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  LOW: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};

function PriorityBadge({ value }: { value: string }) {
  const key = value.toUpperCase();
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${PRIORITY_STYLES[key]}`}
    >
      {key.charAt(0) + key.slice(1).toLowerCase()}
    </span>
  );
}

// Tailwind has no typography plugin here, so each element is styled by hand
// to fit the small chat bubble.
const components: Components = {
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  h1: ({ children }) => <h4 className="text-sm font-semibold mt-1">{children}</h4>,
  h2: ({ children }) => <h4 className="text-sm font-semibold mt-1">{children}</h4>,
  h3: ({ children }) => <h4 className="text-[13px] font-semibold mt-1">{children}</h4>,
  h4: ({ children }) => <h5 className="font-semibold mt-1">{children}</h5>,
  ul: ({ children }) => <ul className="list-disc pl-4 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 dark:text-blue-400 underline underline-offset-2"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-gray-300 dark:border-gray-500 pl-3 text-gray-600 dark:text-gray-300">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-gray-200 dark:border-gray-600" />,
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-md bg-gray-900 text-gray-100 p-3 text-[11px] leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ className, children }) =>
    // Fenced blocks carry a language-* class and are wrapped by `pre` above
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-gray-200 dark:bg-gray-800 px-1 py-0.5 font-mono text-[11px]">
        {children}
      </code>
    ),
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800/60">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-gray-50 dark:bg-gray-900/60 text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
      {children}
    </thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 font-semibold whitespace-nowrap border-b border-gray-200 dark:border-gray-600">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 align-top">
      {typeof children === "string" && PRIORITY_STYLES[children.toUpperCase()] ? (
        <PriorityBadge value={children} />
      ) : (
        children
      )}
    </td>
  ),
};

export default function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="space-y-2 break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
