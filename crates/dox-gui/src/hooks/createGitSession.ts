import { batch, createEffect, createMemo, createSignal, untrack, onCleanup, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { GitSnapshot } from "../types";

type FreezeEvent = { root: string; token: number };
/** Git state is shared by native repository coordinators; drafts stay in each window. */
export function createGitSession(options: {
  library: () => string;
  draftTitles: () => string[];
  busy: () => boolean;
  prepare: (valid: () => boolean) => Promise<void>;
  editorSource: () => number;
}) {
  const [automatic, setAutomatic] = createSignal(false);
  const idleDelay = 10 * 60 * 1000;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let lastEditAt = 0;
  let lastActivity = untrack(options.editorSource);
  const preferenceKey = (root: string) => `dox.git.automatic:${root}`;
  function setAutomaticSync(enabled: boolean) {
    localStorage.setItem(preferenceKey(options.library()), String(enabled));
    setAutomatic(enabled);
  }
  const [queued, setQueued] = createSignal(false);
  function autoSync() {
    if (!automatic() || stopped) return;
    // Focus and periodic checks must not bypass the editing idle delay.
    const remaining = idleDelay - (Date.now() - lastEditAt);
    if (remaining > 0) {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(autoSync, remaining);
      return;
    }
    setQueued(true);
  }
  const [snapshot, setSnapshot] = createSignal<GitSnapshot>();
  const [frozen, setFrozen] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal("");
  let freezeToken: number | undefined;
  let epoch = 0;
  let stopped = false;
  let refreshing = false;
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  const window = getCurrentWindow();
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
  async function sync(automatic = false) {
    const root = options.library();
    if (!root || pending() || snapshot()?.operation || stopped) return;
    const token = epoch;
    setPending(true);
    if (!automatic) setError("");
    try {
      const next = await invoke<GitSnapshot>("git_action", { root, action: "sync", message: "", automatic });
      if (token === epoch) apply(next);
    } catch (e) {
      if (token === epoch) setError(String(e));
    } finally { if (token === epoch) setPending(false); }
  }
  async function reportDrafts() {
    const root = options.library();
    if (!root) return;
    await invoke("git_report_drafts", { root, titles: options.draftTitles() }).catch(() => {});
  }
  createEffect(() => {
    options.library();
    epoch++;
    freezeToken = undefined;
    lastEditAt = 0;
    lastActivity = untrack(options.editorSource);
    setQueued(false);
    batch(() => {
      setSnapshot(undefined); setFrozen(false); setPending(false); setError("");
      setAutomatic(localStorage.getItem(preferenceKey(options.library())) === "true");
    });
    // Do not track status or draft signals as dependencies of a library switch.
    queueMicrotask(() => { void refresh(); reportDrafts(); autoSync(); });
  });
  createEffect(() => {
    options.library();
    draftSignature();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(reportDrafts, 100);
  });
  // A due trigger remains queued while a native operation or local write is active.
  createEffect(() => {
    const ready = queued() && automatic() && !pending() && !snapshot()?.operation && !frozen() && !options.busy();
    if (ready) untrack(() => { setQueued(false); void sync(true); });
  });
  // Depend only on library, preference, and editor activity, never Git snapshots.
  createEffect(() => {
    options.library();
    const activity = options.editorSource();
    if (activity !== lastActivity) lastEditAt = Date.now();
    lastActivity = activity;
    untrack(() => setQueued(false));
    const enabled = automatic();
    clearTimeout(idleTimer);
    if (enabled) idleTimer = setTimeout(autoSync, idleDelay);
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
        let problem: string | null = options.busy() ? "This window is busy. Try again when it finishes." : null;
        if (!problem) {
          try {
            await options.prepare(() => !stopped && freezeToken === payload.token && payload.root === options.library());
            if (options.draftTitles().length) throw new Error("Drafts changed while saving. Sync was cancelled.");
          } catch (e) { problem = String(e); setError(problem); }
        }
        if (stopped || freezeToken !== payload.token || payload.root !== options.library()) return;
        await reportDrafts();
        if (stopped || freezeToken !== payload.token || payload.root !== options.library()) return;
        void invoke("git_ready", { root: payload.root, token: payload.token, problem }).catch((e) => setError(String(e)));
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
    const focus = () => { void refresh(); autoSync(); };
    globalThis.window.addEventListener("online", focus);
    const storage = (event: StorageEvent) => {
      if (event.key === preferenceKey(options.library())) setAutomatic(event.newValue === "true");
    };
    globalThis.window.addEventListener("storage", storage);
    globalThis.window.addEventListener("focus", focus);
    const localTimer = setInterval(() => { if (document.hasFocus()) void refresh(); }, 5000);
    const remoteTimer = setInterval(() => { if (document.hasFocus()) autoSync(); }, 5 * 60 * 1000);
    onCleanup(() => {
      globalThis.window.removeEventListener("focus", focus);
      globalThis.window.removeEventListener("online", focus);
      globalThis.window.removeEventListener("storage", storage);
      clearInterval(localTimer); clearInterval(remoteTimer);
    });
  });
  const cleanups: (() => void)[] = [];
  onCleanup(() => {
    stopped = true; epoch++;
    clearTimeout(draftTimer);
    clearTimeout(idleTimer);
    for (const cleanup of cleanups) cleanup();
  });
  // Polling can replace snapshots without changing operation state.
  const operation = createMemo(() => pending() || !!snapshot()?.operation);
  const drafts = () => snapshot()?.drafts ?? [];
  const hasDrafts = () => options.draftTitles().length > 0 || drafts().some((d) => d.titles.length > 0);
  const problem = createMemo(() => {
    const state = snapshot();
    const s = state?.status;
    // A library without a repository is normal, not a sync failure.
    const unavailable = !s?.available && s?.reason && !/could not find repository|not a git repository/i.test(s.reason) ? s.reason : "";
    return [...new Set([error(), state?.remote_error, state?.result?.success === false ? state.result.message : "", s?.blocked, unavailable,
      s?.conflicts ? "Resolve Git conflicts in an external Git tool." : "",
    ].filter(Boolean))].join("\n");
  });
  const statusLabel = () => {
    if (problem()) return "Sync needs attention";
    if (operation() || frozen()) return "Syncing…";
    if (!snapshot()?.status.available) return snapshot() ? "No Git sync" : "Git…";
    const s = snapshot()!.status;
    const pending = queued() || hasDrafts() || s.changes.length > 0 || (s.ahead ?? 0) > 0 || (s.behind ?? 0) > 0;
    return `${automatic() ? "Automatic sync" : "Automatic sync off"}${pending ? " · Pending changes" : s.upstream ? " · Up to date" : " · No upstream"}`;
  };
  const statusDetail = () => [statusLabel(), snapshot()?.status.branch, snapshot()?.status.upstream, snapshot()?.status.reason, problem()].filter(Boolean).join("\n");
  return { automatic, setAutomaticSync, snapshot, frozen, operation, refresh, sync, problem, statusLabel, statusDetail };
}
export type GitSession = ReturnType<typeof createGitSession>;
