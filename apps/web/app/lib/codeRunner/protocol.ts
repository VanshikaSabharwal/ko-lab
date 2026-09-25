// Messages between the page and a runner worker.

export interface RunRequest {
  type: "run";
  entry: string;
  /** Repo path → file text, for the entry file and everything it imports. */
  files: Record<string, string>;
}

export type WorkerEvent =
  | { type: "stdout" | "stderr"; text: string }
  /** Progress before user code starts, e.g. "Loading Python…". */
  | { type: "status"; text: string }
  /** User code is about to run; the time limit starts counting here. */
  | { type: "started" }
  | { type: "exit"; code: number };
