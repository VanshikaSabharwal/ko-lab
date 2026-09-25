import { dirname, joinPath } from "./paths";

// HTML "runs" as a preview: the page plus its local CSS/JS, inlined into one
// document and shown in a sandboxed iframe. The sandbox gives it an opaque
// origin, so its scripts can't reach Ko-Lab's cookies, storage or APIs.

/** Marks console messages the preview posts up to the page. */
export const PREVIEW_MESSAGE_TAG = "__kolabPreview";

export interface PreviewConsoleMessage {
  [PREVIEW_MESSAGE_TAG]: true;
  level: "log" | "info" | "warn" | "error" | "debug";
  text: string;
}

// Runs first inside the preview: forwards console output and uncaught errors
// to the output panel.
const CONSOLE_BRIDGE = `(function () {
  var send = function (level, args) {
    try {
      var text = Array.prototype.map.call(args, function (a) {
        if (typeof a === "string") return a;
        if (a instanceof Error) return a.stack || String(a);
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }).join(" ");
      parent.postMessage({ ${PREVIEW_MESSAGE_TAG}: true, level: level, text: text }, "*");
    } catch (e) {}
  };
  ["log", "info", "warn", "error", "debug"].forEach(function (level) {
    var original = console[level];
    console[level] = function () {
      send(level, arguments);
      if (original) original.apply(console, arguments);
    };
  });
  addEventListener("error", function (e) {
    send("error", [e.message + (e.lineno ? " (line " + e.lineno + ")" : "")]);
  });
  addEventListener("unhandledrejection", function (e) {
    send("error", ["Unhandled promise rejection: " + ((e.reason && e.reason.message) || e.reason)]);
  });
})();`;

function isLocalRef(ref: string | null): ref is string {
  return !!ref && !/^[a-z][a-z0-9+.-]*:/i.test(ref) && !ref.startsWith("//") && !ref.startsWith("#");
}

/** Build the self-contained preview document for an HTML entry file. */
export function buildPreviewDocument(entry: string, files: Record<string, string>): string {
  const doc = new DOMParser().parseFromString(files[entry] ?? "", "text/html");
  const lookup = (ref: string) => {
    const path = joinPath(dirname(entry), ref.split(/[?#]/)[0]!);
    return path !== null ? files[path] : undefined;
  };

  doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]').forEach((link) => {
    const href = link.getAttribute("href");
    if (!isLocalRef(href)) return;
    const css = lookup(href);
    if (css === undefined) return;
    const style = doc.createElement("style");
    style.textContent = css;
    link.replaceWith(style);
  });

  doc.querySelectorAll<HTMLScriptElement>("script[src]").forEach((script) => {
    const src = script.getAttribute("src");
    if (!isLocalRef(src)) return;
    const js = lookup(src);
    if (js === undefined) return;
    script.removeAttribute("src");
    // outerHTML doesn't escape script text, so a literal "</script" in the
    // file would end the element early once the document is re-parsed
    script.textContent = js.replace(/<\/script/gi, "<\\/script");
  });

  const bridge = doc.createElement("script");
  bridge.textContent = CONSOLE_BRIDGE;
  doc.head.prepend(bridge);

  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

/** Sandbox for the preview iframe: scripts, forms and alerts, but no same-origin access. */
export const PREVIEW_SANDBOX = "allow-scripts allow-forms allow-modals allow-popups";

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Open the preview full-size in a new tab. The tab is a local blob: page that
 * only wraps the same sandboxed iframe — the blob page itself shares Ko-Lab's
 * origin, so the user's scripts must never run in it directly.
 */
export function openPreviewInNewTab(html: string, title: string): void {
  const wrapper = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeAttribute(title)} · Preview</title>
<style>html,body{margin:0;height:100%;background:#fff}iframe{display:block;border:0;width:100%;height:100%}</style>
</head><body><iframe sandbox="${PREVIEW_SANDBOX}" srcdoc="${escapeAttribute(html)}"></iframe></body></html>`;
  const url = URL.createObjectURL(new Blob([wrapper], { type: "text/html" }));
  window.open(url, "_blank", "noopener");
  // The new tab has loaded it by then; free the memory
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
