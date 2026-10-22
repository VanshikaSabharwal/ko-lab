/**
 * Editor settings come out of localStorage, which can hold an older shape or
 * anything a user typed into dev tools, so reading them has to tolerate both.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_IDE_SETTINGS,
  basicSetupFor,
  readRepoPrefs,
  readStoredIdeSettings,
  writeRepoPrefs,
} from "../../app/code-editor/[groupId]/[githubRepo]/lib/ideSettings";

const KEY = "ko-lab:ide-settings";

beforeEach(() => localStorage.clear());

describe("readStoredIdeSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    expect(readStoredIdeSettings()).toEqual(DEFAULT_IDE_SETTINGS);
  });

  it("fills in settings added after the stored copy was written", () => {
    localStorage.setItem(KEY, JSON.stringify({ fontSize: 18, themeId: "dracula" }));

    expect(readStoredIdeSettings()).toEqual({
      ...DEFAULT_IDE_SETTINGS,
      fontSize: 18,
      themeId: "dracula",
    });
  });

  it("keeps valid choices", () => {
    const chosen = {
      ...DEFAULT_IDE_SETTINGS,
      tabSize: 4,
      useTabs: true,
      wordWrap: true,
      autoSave: "afterDelay",
      openFirst: "last",
      confirmDiscard: false,
      terminalCommand: "npm start",
    };
    localStorage.setItem(KEY, JSON.stringify(chosen));

    expect(readStoredIdeSettings()).toEqual(chosen);
  });

  it("replaces values that aren't valid choices", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        fontSize: 500,
        themeId: "no-such-theme",
        tabSize: 3,
        wordWrap: "yes",
        autoSave: "always",
        openFirst: 7,
        terminalFontSize: -4,
        terminalCommand: { run: "rm" },
      }),
    );

    expect(readStoredIdeSettings()).toEqual({
      ...DEFAULT_IDE_SETTINGS,
      fontSize: 28,
      terminalFontSize: 10,
    });
  });

  it("falls back to the defaults when the stored value isn't JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(readStoredIdeSettings()).toEqual(DEFAULT_IDE_SETTINGS);
  });
});

describe("basicSetupFor", () => {
  it("turns the gutter features off with their settings", () => {
    const setup = basicSetupFor({
      ...DEFAULT_IDE_SETTINGS,
      lineNumbers: false,
      foldGutter: false,
      closeBrackets: false,
      tabSize: 8,
    });

    expect(setup).toMatchObject({
      lineNumbers: false,
      highlightActiveLineGutter: false,
      foldGutter: false,
      closeBrackets: false,
      tabSize: 8,
    });
  });
});

describe("repo prefs", () => {
  it("are kept per project and merged on write", () => {
    writeRepoPrefs("g1", { startBranch: "dev" });
    writeRepoPrefs("g1", { tabs: ["a.js", "b.js"], active: "b.js" });
    writeRepoPrefs("g2", { startBranch: "main" });

    expect(readRepoPrefs("g1")).toEqual({ startBranch: "dev", tabs: ["a.js", "b.js"], active: "b.js" });
    expect(readRepoPrefs("g2").startBranch).toBe("main");
  });

  it("clears a value written as undefined", () => {
    writeRepoPrefs("g1", { startBranch: "dev" });
    writeRepoPrefs("g1", { startBranch: undefined });

    expect(readRepoPrefs("g1").startBranch).toBeUndefined();
  });

  it("ignores stored values of the wrong type", () => {
    localStorage.setItem("ko-lab:ide-repo:g1", JSON.stringify({ startBranch: 5, tabs: ["a.js", 9] }));

    expect(readRepoPrefs("g1")).toEqual({ startBranch: undefined, tabs: ["a.js"], active: undefined });
  });
});
