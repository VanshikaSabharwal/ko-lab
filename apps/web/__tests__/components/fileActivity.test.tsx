import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

/**
 * "Who else has this file open" in the code editor, over the group's live
 * connection (faked here).
 */
const socket = vi.hoisted(() => ({
  onRemoteOp: null as null | ((op: any, from?: string) => void),
  sendOp: vi.fn(),
  presence: [] as string[],
  isConnected: true,
}));
vi.mock("../../app/workspace/lib/useWorkspaceSocket", () => ({
  useWorkspaceSocket: (opts: { onRemoteOp: (op: any, from?: string) => void; board: string }) => {
    expect(opts.board).toBe("CODE");
    socket.onRemoteOp = opts.onRemoteOp;
    return { presence: socket.presence, sendOp: socket.sendOp, isConnected: socket.isConnected, isOffline: false };
  },
}));

import { useFileActivity } from "../../app/code-editor/[groupId]/[githubRepo]/lib/useFileActivity";
import { describeActivity } from "../../app/code-editor/[groupId]/[githubRepo]/components/FileActivityBadge";

const props = { groupId: "g1", userId: "me", userName: "Asha", openPath: "src/app.js", editing: false };
const announce = (from: string, path: string | null, editing = false, name = "Bilal Friend") =>
  act(() => socket.onRemoteOp!({ action: "file_activity", path, name, editing }, from));

beforeEach(() => {
  vi.clearAllMocks();
  socket.presence = ["me", "bilal"];
});

describe("useFileActivity", () => {
  it("announces the open file, and again when unsaved edits start", () => {
    const { rerender } = renderHook((p) => useFileActivity(p), { initialProps: props });
    expect(socket.sendOp).toHaveBeenLastCalledWith({
      action: "file_activity",
      path: "src/app.js",
      name: "Asha",
      editing: false,
    });

    rerender({ ...props, editing: true });
    expect(socket.sendOp).toHaveBeenLastCalledWith(expect.objectContaining({ editing: true }));
  });

  it("lists other people by the file they have open", () => {
    const { result } = renderHook(() => useFileActivity(props));
    announce("bilal", "src/app.js", true);

    expect(result.current.get("src/app.js")).toEqual([{ userId: "bilal", name: "Bilal Friend", editing: true }]);
  });

  it("moves someone when they switch files, and forgets them when they leave", () => {
    const { result } = renderHook(() => useFileActivity(props));
    announce("bilal", "src/app.js");
    announce("bilal", "README.md");
    expect(result.current.get("src/app.js")).toBeUndefined();
    expect(result.current.get("README.md")).toHaveLength(1);

    announce("bilal", null);
    expect(result.current.size).toBe(0);
  });

  it("never shows you yourself (another tab of yours)", () => {
    const { result } = renderHook(() => useFileActivity(props));
    announce("me", "src/app.js", true, "Asha");
    expect(result.current.size).toBe(0);
  });

  it("ignores messages that aren't file activity", () => {
    const { result } = renderHook(() => useFileActivity(props));
    act(() => socket.onRemoteOp!({ action: "nodes_change" }, "bilal"));
    expect(result.current.size).toBe(0);
  });

  it("drops someone who has left the room", () => {
    const { result, rerender } = renderHook(() => useFileActivity(props));
    announce("bilal", "src/app.js");
    socket.presence = ["me"];
    rerender();
    expect(result.current.size).toBe(0);
  });

  it("says it's leaving when the editor closes", () => {
    const { unmount } = renderHook(() => useFileActivity(props));
    unmount();
    expect(socket.sendOp).toHaveBeenLastCalledWith(expect.objectContaining({ path: null }));
  });
});

describe("describeActivity", () => {
  it("says who, and whether they're editing or just looking", () => {
    expect(describeActivity([{ userId: "b", name: "Bilal Friend", editing: true }])).toBe(
      "Bilal is editing this file",
    );
    expect(
      describeActivity([
        { userId: "b", name: "Bilal", editing: false },
        { userId: "c", name: "Chen", editing: false },
      ]),
    ).toBe("Bilal and Chen have this file open");
  });
});
