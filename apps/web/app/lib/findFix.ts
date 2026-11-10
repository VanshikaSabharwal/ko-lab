/**
 * Pure helpers for the editor's "Find fix" feature (SearchApi + Groq).
 *
 * Everything here runs before text leaves the server: secrets are redacted,
 * and the search query is reduced to the generic shape of the error so it
 * matches other people's reports of the same problem.
 */

export interface FixSearchResult {
  title: string;
  link: string;
  snippet: string;
}

const R = "[REDACTED]";

/** Keys whose values are secrets, in KEY=value, key: value and "key": "value" form. */
const SECRET_KEY =
  "(?:[A-Za-z0-9_]*?(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|auth|credentials?)[A-Za-z0-9_]*)";

const SECRET_PATTERNS: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  // Credentials inside connection strings: scheme://user:pass@host → keep scheme and host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, (_m, scheme) => `${scheme}${R}@`],
  // JWTs
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, R],
  // Provider key formats
  [/\b(?:sk|pk|rk)[-_](?:live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}/g, R],
  [/\bgsk_[A-Za-z0-9]{20,}/g, R],
  [/\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}/g, R],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, R],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, R],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, R],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, R],
  // Authorization headers
  [/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{12,}/g, (_m, kind) => `${kind} ${R}`],
  // "apiKey": "value"  /  'token': 'value'
  [
    new RegExp(`(["']${SECRET_KEY}["']\\s*:\\s*)(["'])[^"'\\n]+\\2`, "gi"),
    (_m, head, q) => `${head}${q}${R}${q}`,
  ],
  // password=value, API_KEY: value, token = value
  [
    new RegExp(`\\b(${SECRET_KEY}\\s*[:=]\\s*)(["']?)[^\\s"',;&]+\\2`, "gi"),
    (_m, head, q) => `${head}${q}${R}${q}`,
  ],
];

/** .env-style line: SOME_NAME=value. Only applied to code snippets. */
const ENV_LINE = /^(\s*(?:export\s+)?[A-Z][A-Z0-9_]{2,}\s*=\s*)(.+)$/gm;

/**
 * Removes credentials from error text or code before it is sent anywhere.
 *
 * Deliberately no blanket "long random string" rule: git SHAs and package
 * integrity hashes are useful context and are not secrets.
 */
export function redactSecrets(text: string, opts: { envLines?: boolean } = {}): string {
  let out = text;
  for (const [re, rep] of SECRET_PATTERNS) {
    out = out.replace(re, rep as (substring: string, ...args: string[]) => string);
  }
  if (opts.envLines) {
    out = out.replace(ENV_LINE, (_m, head: string, value: string) =>
      value.includes(R) ? `${head}${value}` : `${head}${R}`,
    );
  }
  return out;
}

// Terminal colour codes in run output; matching \x1b is the point
// eslint-disable-next-line no-control-regex
const ANSI =/\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Messages whose quoted name is a module or package: keep the name, it *is* the search. */
const MODULE_MESSAGE =
  /(cannot find module|can't resolve|could not resolve|failed to resolve import|no module named|module not found|err_module_not_found|cannot find package|unable to resolve|from\s|require\(|import\()/i;

/** Value errors where the quoted/leading name is the user's own variable. */
const IDENTIFIER_RULES: Array<[RegExp, string]> = [
  [/\b[\w$.[\]]+ is not a function\b/g, "is not a function"],
  [/\b[\w$.[\]]+ is not a constructor\b/g, "is not a constructor"],
  [/\b[\w$.[\]]+ is not iterable\b/g, "is not iterable"],
  [/\b[\w$]+ is not defined\b/g, "is not defined"],
  [/['"`][\w$]+['"`] is not defined/g, "is not defined"],
  [/\(reading ['"][^'"]*['"]\)/g, "(reading property)"],
  [/\(setting ['"][^'"]*['"]\)/g, "(setting property)"],
  [/\bCannot access ['"][\w$]+['"] before initialization/g, "Cannot access variable before initialization"],
  [/\bIdentifier ['"][\w$]+['"] has already been declared/g, "Identifier has already been declared"],
  [/\bname ['"][\w$]+['"] is not defined/g, "name is not defined"],
  [/\bobject has no attribute ['"][\w$]+['"]/g, "object has no attribute"],
  [/\b(local variable) ['"][\w$]+['"]/g, "$1"],
];

/**
 * Turns a raw error into a search query: the error type and first error line,
 * with paths, positions and the user's own identifiers stripped. Package and
 * module names are kept.
 */
export function normalizeError(text: string): string {
  const lines = text
    .replace(ANSI, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    // Stack frames and pointer lines carry no search value
    .filter((l) => !/^at\s/.test(l) && !/^File\s+"/.test(l) && !/^\^+\s*$/.test(l) && !/^~+\s*$/.test(l));

  const typed = lines.find((l) => /\b\w*(Error|Exception|Warning)\b\s*[:[]/.test(l) || /^\w*Error\b/.test(l));
  let line = typed ?? lines[0] ?? "";

  // URLs, then file paths (absolute, relative, Windows), then :line:col
  line = line
    .replace(/\bhttps?:\/\/\S+/g, "")
    // Absolute paths (/home/x/app.js, C:\x\app.js). The lookbehind keeps
    // package specifiers like '@scope/pkg/sub' intact.
    .replace(/(?:file:\/\/)?(?<![\w@.-])(?:[A-Za-z]:)?[\\/](?:[^\s'"():]+[\\/])+[^\s'"():]+/g, "")
    // Relative paths (./src/app.js, ../lib)
    .replace(/(?<![\w@])\.\.?\/(?:[^\s'"():]+\/)*[^\s'"():]+/g, "")
    .replace(/:\d+(?::\d+)?\b/g, "")
    .replace(/\bline \d+(, column \d+)?/gi, "")
    .replace(/\(\d+:\d+\)/g, "")
    .replace(/\b0x[0-9a-f]+\b/gi, "");

  if (!MODULE_MESSAGE.test(line)) {
    for (const [re, rep] of IDENTIFIER_RULES) line = line.replace(re, rep);
  }

  return line
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([:,)])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim()
    .slice(0, 200)
    .trim();
}

interface RunChunk {
  stream: "stdout" | "stderr" | "info";
  text: string;
}
interface RunEndLike {
  code: number;
  reason: "exit" | "timeout" | "stopped" | "output-limit" | "crashed";
}

/** The error to search for from a finished run, or null when the run succeeded. */
export function extractRunError(chunks: RunChunk[], end: RunEndLike | null): string | null {
  const stderr = chunks
    .filter((c) => c.stream === "stderr")
    .map((c) => c.text)
    .join("")
    .trim();
  if (stderr) {
    // Python tracebacks and Node errors put the useful line last; keep the tail
    const tail = stderr.split(/\r?\n/).slice(-30).join("\n");
    return tail.slice(-2000);
  }
  if (!end) return null;
  if (end.reason === "timeout") return "Script timed out: infinite loop or long running code";
  if (end.reason === "crashed") return "Code runner worker crashed";
  if (end.reason === "exit" && end.code !== 0) return `Process exited with code ${end.code}`;
  return null;
}

/** ±`radius` lines around a 1-based line, prefixed with line numbers. */
export function snippetAround(doc: string, line: number, radius = 10): string {
  const lines = doc.split("\n");
  const at = Math.min(Math.max(1, line), Math.max(1, lines.length));
  const start = Math.max(1, at - radius);
  const end = Math.min(lines.length, at + radius);
  const width = String(end).length;
  const out: string[] = [];
  for (let n = start; n <= end; n++) {
    out.push(`${String(n).padStart(width)}${n === at ? ">" : " "} ${lines[n - 1]}`);
  }
  return out.join("\n").slice(0, 4000);
}

/** A line number for `fileName` mentioned in an error, e.g. "main.py, line 4" or "app.js:12:5". */
export function errorLineFor(error: string, fileName: string): number | null {
  if (!fileName) return null;
  const esc = fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m =
    new RegExp(`${esc}(?:\\)|["'])?(?::|, line )(\\d+)`).exec(error) ??
    /\((\d+):\d+\)/.exec(error);
  return m ? Number(m[1]) : null;
}

/** Drops [k] citations that point at results which don't exist. */
export function validateCitations(text: string, count: number): string {
  return text
    .replace(/\[(\d+)\]/g, (m, k) => {
      const n = Number(k);
      return n >= 1 && n <= count ? m : "";
    })
    .replace(/[ \t]+([.,;:])/g, "$1");
}

/** Stack Overflow, GitHub and official docs first; order otherwise kept. */
const PREFERRED = /(^|\.)(stackoverflow\.com|github\.com|developer\.mozilla\.org|docs\.python\.org|nodejs\.org|typescriptlang\.org|react\.dev|nextjs\.org)$/;

export function rankResults(results: FixSearchResult[]): FixSearchResult[] {
  const host = (link: string) => {
    try {
      return new URL(link).hostname;
    } catch {
      return "";
    }
  };
  return results
    .map((r, i) => ({ r, i, p: PREFERRED.test(host(r.link)) ? 0 : 1 }))
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map((x) => x.r);
}
