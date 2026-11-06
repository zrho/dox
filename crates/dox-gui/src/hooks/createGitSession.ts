import { batch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { GitAction, GitDiff, GitSnapshot } from "../types";

type FreezeEvent = { root: string; token: number };
/** Git state is shared by native repository coordinators; drafts stay in each window. */
export function createGitSession(options: {
  library: () => string;
  draftTitles: () => string[];
  busy: () => boolean;
}) {
  const [snapshot, setSnapshot] = createSignal<GitSnapshot>();
  const [frozen, setFrozen] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [message, setMessage] = createSignal("");
  const [error, setError] = createSignal("");
  let freezeToken: number | undefined;
  let epoch = 0;
  let stopped = false;
  let refreshing = false;
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  const window = getCurrentWindow();
  const label = window.label;
  const draftSignature = createMemo(() => JSON.stringify(options.draftTitles()));
  function apply(next: GitSnapshot) {
    if (next.root !== options.library()) return;
    const current = snapshot();
    if (!current || next.revision >= current.revision) setSnapshot(next);
  }
  async function refresh(force = false) {
    const root = options.library();
    if (!root || refreshing || stopped) return;
    const token = epoch;
    refreshing = true;
    try {
      const next = await invoke<GitSnapshot>("git_status", { root, force });
      if (token === epoch) { apply(next); setError(""); }
    } catch (e) {
      if (token === epoch) setError(String(e));
    } finally { refreshing = false; }
  }
  async function act(action: GitAction, automatic = false) {
    const root = options.library();
    if (!root || pending() || snapshot()?.operation || stopped) return;
    const token = epoch;
    setPending(true);
    if (!automatic) setError("");
    try {
      const next = await invoke<GitSnapshot>("git_action", { root, action, message: message(), automatic });
      if (token === epoch) {
        apply(next);
        if (!automatic && next.result?.commit) setMessage("");
      }
    } catch (e) {
      if (token === epoch) setError(String(e));
    } finally { if (token === epoch) setPending(false); }
  }
  async function diff(path: string) {
    return invoke<GitDiff>("git_diff", { root: options.library(), path });
  }
  function reportDrafts() {
    const root = options.library();
    if (!root) return;
    void invoke("git_report_drafts", { root, titles: options.draftTitles() }).catch(() => {});
  }
  createEffect(() => {
    options.library();
    epoch++;
    freezeToken = undefined;
    batch(() => {
      setSnapshot(undefined); setFrozen(false); setPending(false); setMessage(""); setError("");
    });
    // Do not track status or draft signals as dependencies of a library switch.
    queueMicrotask(() => { void refresh(); reportDrafts(); void act("fetch", true); });
  });
  createEffect(() => {
    options.library();
    draftSignature();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(reportDrafts, 100);
  });
  onMount(() => {
    const subscriptions = [
      window.listen<GitSnapshot>("git-state", (event) => apply(event.payload)),
      window.listen<FreezeEvent>("git-prepare", async ({ payload }) => {
        if (payload.root !== options.library()) return;
        freezeToken = payload.token;
        setFrozen(true);
        // Let a write already in progress settle; no new writes may begin.
        const deadline = Date.now() + 4000;
        while (options.busy() && Date.now() < deadline && freezeToken === payload.token) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        if (stopped || freezeToken !== payload.token || payload.root !== options.library()) return;
        const titles = options.draftTitles();
        const problem = options.busy() ? "This window is busy. Try again when it finishes."
          : titles.length ? `Save unsaved drafts first: ${titles.join(", ")}` : null;
        void invoke("git_ready", { root: payload.root, token: payload.token, problem }).catch(() => {});
      }),
      window.listen<FreezeEvent>("git-release", ({ payload }) => {
        if (payload.root !== options.library() || payload.token !== freezeToken) return;
        freezeToken = undefined;
        setFrozen(false);
      }),
    ];
    for (const subscription of subscriptions) {
      void subscription.then((unlisten) => { if (stopped) unlisten(); else cleanups.push(unlisten); }).catch((e) => setError(String(e)));
    }
    const focus = () => { void refresh(); void act("fetch", true); };
    globalThis.window.addEventListener("focus", focus);
    const localTimer = setInterval(() => { if (document.hasFocus()) void refresh(); }, 5000);
    const remoteTimer = setInterval(() => { if (document.hasFocus()) void act("fetch", true); }, 5 * 60 * 1000);
    onCleanup(() => {
      globalThis.window.removeEventListener("focus", focus);
      clearInterval(localTimer); clearInterval(remoteTimer);
    });
  });
  const cleanups: (() => void)[] = [];
  onCleanup(() => {
    stopped = true; epoch++;
    clearTimeout(draftTimer);
    for (const cleanup of cleanups) cleanup();
  });
  // Polling replaces the snapshot even when its operation state is unchanged.
  // Memoize the boolean so consumers such as expanded diffs stay mounted and idle.
  const operation = createMemo(() => pending() || !!snapshot()?.operation);
  const drafts = () => snapshot()?.drafts ?? [];
  const hasDrafts = () => options.draftTitles().length > 0 || drafts().some((d) => d.titles.length > 0);
  const writable = () => !!snapshot()?.status.available && !!snapshot()?.status.branch && !snapshot()?.status.blocked;
  const canCommit = () => writable() && !hasDrafts() && !options.busy() && !!snapshot()?.status.changes.length && (!snapshot()?.status.staged || !!snapshot()?.status.retry_commit);
  const canPull = () => writable() && !hasDrafts() && !options.busy() && !!snapshot()?.status.upstream && !snapshot()?.status.changes.length && !((snapshot()?.status.ahead ?? 0) > 0 && (snapshot()?.status.behind ?? 0) > 0);
  const canPush = () => writable() && !!snapshot()?.status.upstream;
  const statusLabel = () => {
    const state = snapshot();
    if (!state) return "Git…";
    if (!state.status.available) return "Git unavailable";
    const s = state.status;
    return `${s.branch ?? "Detached HEAD"}${s.upstream ? ` · ${s.upstream}` : ""} · ${s.changes.length} changed${s.ahead !== null ? ` · ↑${s.ahead} ↓${s.behind ?? 0}` : ""}`;
  };
  return { snapshot, frozen, operation, message, setMessage, error, refresh, act, diff, drafts, hasDrafts, canCommit, canPull, canPush, statusLabel, label };
}
export type GitSession = ReturnType<typeof createGitSession>;
