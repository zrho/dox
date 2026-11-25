import { batch, cleanup, computed, effect, keymap, mount, Scroll, signal, Storage, Text, View } from "nsh";
import { Application, currentWindow, titleBar } from "nsh/desktop";
import { AlertDialog, Button, Tooltip } from "nsh/base";
import { Reader } from "dox-nsh/native";
import { Picker, type PickerItem } from "./Picker";
import { PublicationDialog } from "./PublicationDialog";
import { Icon, IconButton } from "./Icon";
import type { InputRef } from "nsh/types";
import { dirty, Workspace, type Entry, type Pane, type Reading, type Selection } from "./Workspace";

type Issue = { id: string; severity: "error" | "warning" | "proposal"; message: string; note_id: string | null };
type Index = { entries: Entry[]; diagnostics: Issue[] };
type Opened = { path: string; index: Index; watch_error: string | null };
type GitSummary = { branch: string | null; upstream: string | null; changed: number; ahead: number | null; behind: number | null };

const emptyIndex: Index = { entries: [], diagnostics: [] };
const LIBRARY_KEY = "dox.library";
const AUTO_SYNC_IDLE = 10 * 60_000;
const AUTO_SYNC_INTERVAL = 5 * 60_000;
const autoSyncKey = (root: string) => `dox.git.automatic:${root}`;

function App() {
  const window = currentWindow();
  window.set({ titleBar: { style: "hidden", height: 28 }, closeOnPress: false });

  const path = signal("");
  const index = signal(emptyIndex);
  const git = signal<GitSummary | null>(null);
  const panes = signal<Pane[]>([]);
  const activeKey = signal<number | null>(null);
  const reveal = signal(0);
  const overlay = signal<"commands" | "notes" | "link" | "publication" | null>(null);
  const diagnosticsOpen = signal(false);
  const automatic = signal(false);
  const opening = signal(false);
  const refreshing = signal(false);
  const libraryError = signal("");
  const watchError = signal("");
  const confirming = signal(false);
  const editorFocused = signal<number | null>(null);
  const activePane = computed(() => panes().find((pane) => pane.key === activeKey()));
  const operation = signal("");
  const syncError = signal("");
  const lastDeleted = signal<string | null>(null);
  const syncing = () => operation() === "Syncing…";
  const busy = () => opening() || !!operation() || confirming();
  const editors = new Map<number, InputRef>();
  const selections = new Map<number, Selection>();
  let pendingLink: (Selection & { key: number; source: string }) | undefined;
  let generation = 0;
  let seenChanges = 0;
  let lastEditAt = 0;
  let nextAutoSyncAt = 0;
  let refreshAfterSave = false;
  const spareKey = signal(1);
  let gitRequest = 0;

  const noteItems = computed<PickerItem[]>(() => index().entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    detail: entry.id,
    icon: entry.kind === "literature" ? "reference" : "note",
  })));
  const commands = computed<PickerItem[]>(() => [
    { id: "open", title: "Open library", detail: "⌘O", disabled: opening() },
    { id: "find", title: "Find note", detail: "⌘P", disabled: !path() || opening() || syncing() },
    { id: "new", title: "New note", detail: "⌘N", disabled: !path() || busy() },
    { id: "daily", title: "Open today’s note", detail: "⌘⇧D", disabled: !path() || busy() },
    { id: "literature", title: "New empty literature item", disabled: !path() || busy() },
    { id: "link", title: "Insert link or citation", detail: "⌘K", disabled: !canInsert() },
    { id: "attach", title: "Attach files to item", disabled: !activePane()?.note || busy() },
    { id: "pdf", title: "Find and attach paper PDF", disabled: activePane()?.note?.entry.kind !== "literature" || busy() },
    { id: "publication", title: "Import publication from link or tag", disabled: !path() || busy() },
    { id: "bibtex", title: "Import literature from BibTeX file…", disabled: !path() || busy() },
    { id: "sync", title: "Sync now", disabled: !git() || !canSync() },
    { id: "auto-sync", title: automatic() ? "Disable automatic sync" : "Enable automatic sync", disabled: busy() || (!automatic() && !git()?.upstream) },
    { id: "refresh", title: "Refresh library index", disabled: !path() || refreshing() || busy() },
    { id: "edit", title: activePane()?.editing ? "Save and view note" : "Edit source", detail: "E", disabled: !activePane()?.note || activePane()?.updating || activePane()?.saving },
    { id: "save", title: "Save note", detail: "⌘S", disabled: busy() || !activePane()?.editing || activePane()?.saving || !dirty(activePane()) },
    { id: "reload", title: "Reload focused note from disk", disabled: !activePane() || activePane()?.saving || activePane()?.updating },
    { id: "close", title: "Close focused pane", detail: "⌘W", disabled: activeKey() === null },
    { id: "delete", title: "Delete note", detail: "D", disabled: !canDelete() },
    { id: "restore", title: "Undo last note deletion", disabled: !lastDeleted() || busy() },
    { id: "previous", title: "Focus previous pane", detail: "J / ←", disabled: neighbor(-1) === undefined },
    { id: "next", title: "Focus next pane", detail: "K / →", disabled: neighbor(1) === undefined },
    { id: "move-left", title: "Move pane left", detail: "⇧J / ⇧←", disabled: neighbor(-1) === undefined },
    { id: "move-right", title: "Move pane right", detail: "⇧K / ⇧→", disabled: neighbor(1) === undefined },
    { id: "diagnostics", title: "Toggle library diagnostics", disabled: !index().diagnostics.length },
  ]);
  const gitStatus = computed(() => {
    const gitInfo = git();
    if (!gitInfo) return null;
    const branch = gitInfo.branch ?? "Detached HEAD";
    const status = syncing() ? { icon: "sync", label: "Syncing" } as const
      : syncError() ? { icon: "syncError", label: "Sync needs attention" } as const
      : !gitInfo.upstream ? { icon: "noUpstream", label: "No upstream" } as const
      : gitInfo.changed || gitInfo.ahead || gitInfo.behind ? { icon: "pending", label: "Pending sync" } as const
      : { icon: "synced", label: "Up to date" } as const;
    const counts = [
      `${gitInfo.changed} changed ${gitInfo.changed === 1 ? "file" : "files"}`,
      gitInfo.ahead == null ? null : `${gitInfo.ahead} ahead`,
      gitInfo.behind == null ? null : `${gitInfo.behind} behind`,
    ].filter(Boolean).join(" · ");
    return {
      branch,
      icon: status.icon,
      description: `${branch} · ${status.label} · Automatic sync ${automatic() ? "on" : "off"}`,
      details: [
        `${branch} · ${status.label}`,
        gitInfo.upstream ? `Upstream: ${gitInfo.upstream}` : null,
        counts,
        automatic() ? "Automatic sync on" : gitInfo.upstream
          ? "Automatic sync off · Sync now is still available"
          : "Automatic sync off",
        syncError() || null,
      ].filter(Boolean).join("\n"),
    };
  });
  const home = Reader.homeDirectory().replace(/\/+$/, "");
  const displayPath = computed(() => home && (path() === home || path().startsWith(`${home}/`)) ? `~${path().slice(home.length)}` : path());
  const parentPath = () => displayPath().slice(0, displayPath().lastIndexOf("/") + 1);
  const folderName = () => displayPath().slice(parentPath().length) || displayPath();

  async function refresh(epoch: number) {
    if (!path() || refreshing()) return;
    refreshing.set(true);
    const serial = ++gitRequest;
    void Reader.gitSummary().then((result) => {
      if (epoch === generation && serial === gitRequest) git.set(result == null ? null : JSON.parse(result));
    }).catch(() => {
      if (epoch === generation && serial === gitRequest) git.set(null);
    });
    try {
      const next: Index = JSON.parse(await Reader.refresh());
      if (epoch !== generation) return;
      index.set(next);
      for (const pane of panes()) {
        if (epoch !== generation) return;
        const live = paneByKey(pane.key);
        if (!live || live.saving || live.updating || !live.note) continue;
        const entry = next.entries.find((candidate) => candidate.id === live.id);
        if (dirty(live)) {
          patchPane(live.key, { external: entry?.revision !== live.note.revision });
        } else if (entry === undefined) {
          patchPane(live.key, { external: true, problem: "This note is no longer in the index." });
        } else {
          await reloadPane(live, epoch);
        }
      }
    } catch (error) {
      if (epoch === generation) libraryError.set(String(error));
    } finally {
      if (epoch === generation) refreshing.set(false);
    }
  }

  async function openLibrary(restore = false) {
    if (busy()) return;
    if (!restore && !canLeaveLibrary()) return;
    if (!restore) overlay.set(null);
    opening.set(true);
    libraryError.set("");
    try {
      const stored = restore ? await Storage.getItem(LIBRARY_KEY) : null;
      if (restore && !stored) return;
      const result = await Reader.openLibrary(stored);
      if (result == null) return;
      const opened: Opened = JSON.parse(result);
      const epoch = ++generation;
      // The new session starts its own counter. Any changes during open are
      // picked up by the initial index refresh or by the next watcher tick.
      seenChanges = Reader.changeVersion();
      watchError.set(opened.watch_error ?? "");
      path.set(opened.path);
      index.set(opened.index);
      git.set(null);
      syncError.set("");
      lastDeleted.set(null);
      automatic.set(false);
      lastEditAt = 0;
      nextAutoSyncAt = Date.now() + AUTO_SYNC_IDLE;
      panes.set([]);
      activeKey.set(null);
      editors.clear();
      selections.clear();
      editorFocused.set(null);
      refreshAfterSave = false;
      diagnosticsOpen.set(false);
      refreshing.set(false);
      void refresh(epoch);
      try {
        automatic.set(await Storage.getItem(autoSyncKey(opened.path)) === "true");
      } catch (error) {
        libraryError.set(`Could not read the automatic sync preference: ${error}`);
      }
      if (opened.path !== stored) {
        try {
          await Storage.setItem(LIBRARY_KEY, opened.path);
        } catch (error) {
          libraryError.set(`Could not remember the library path: ${error}`);
        }
      }
    } catch (error) {
      libraryError.set(restore ? `Could not reopen the last library: ${error}` : String(error));
    } finally {
      opening.set(false);
    }
  }

  function activate(key: number, forceReveal = false) {
    if (key === activeKey() && !forceReveal) return;
    activeKey.set(key);
    reveal.set(reveal() + 1);
  }

  async function openNote(id: string) {
    if (!path() || opening() || syncing()) return;
    const existing = panes().find((pane) => pane.id === id);
    if (existing) {
      activate(existing.key, true);
      if (!existing.error) return;
    }
    const epoch = generation;
    const key = existing?.key ?? spareKey();
    const pending = { key, id };
    batch(() => {
      panes.set(existing ? panes().map((pane) => pane.key === key ? pending : pane) : [...panes(), pending]);
      if (!existing) spareKey.set(key + 1);
      activate(key, true);
    });
    let result: Pane;
    try {
      const note: Reading = JSON.parse(await Reader.readNote(id));
      result = { key, id, note };
    } catch (error) {
      result = { key, id, error: String(error) };
    }
    if (epoch === generation && panes().some((pane) => pane.key === key)) {
      panes.set(panes().map((pane) => pane.key === key ? result : pane));
    }
  }

  function paneByKey(key: number) {
    return panes().find((pane) => pane.key === key);
  }

  function patchPane(key: number, patch: Partial<Pane>) {
    panes.set(panes().map((pane) => pane.key === key ? { ...pane, ...patch } : pane));
  }

  function newPane(id: string, data: Partial<Pane> = {}) {
    const key = spareKey();
    batch(() => {
      panes.set([...panes(), { ...data, id, key }]);
      spareKey.set(key + 1);
      activate(key, true);
    });
    return key;
  }

  function setDraft(key: number, draft: string) {
    const pane = paneByKey(key);
    if (pane?.editing && (pane.draft ?? pane.note?.source) !== draft) {
      lastEditAt = Date.now();
      patchPane(key, { draft });
    }
  }

  async function reloadPane(pane: Pane, epoch: number, discardDraft = false) {
    const current = paneByKey(pane.key);
    if (epoch !== generation || !current || current.saving || current.updating) return;
    patchPane(pane.key, { updating: true });
    try {
      const note: Reading = JSON.parse(await Reader.readNote(pane.id));
      const live = paneByKey(pane.key);
      if (epoch !== generation || !live) return;
      // Edits can happen while a refresh is in flight. Only an explicitly
      // confirmed discard of this exact draft can replace it.
      if (dirty(live) && !(discardDraft && current.draft === live.draft)) {
        if (live.note?.revision !== note.revision) patchPane(pane.key, { external: true });
        return;
      }
      patchPane(pane.key, { note, draft: undefined, external: false, problem: undefined, error: undefined });
    } catch (error) {
      if (epoch === generation) patchPane(pane.key, { external: true, problem: `Could not reload: ${error}` });
    } finally {
      if (epoch === generation) patchPane(pane.key, { updating: false });
    }
  }

  async function confirmReload() {
    const pane = activePane();
    if (!pane || pane.saving || pane.updating || busy()) return;
    const epoch = generation;
    if (dirty(pane)) {
      confirming.set(true);
      try {
        const result = await AlertDialog.show({
          title: "Discard unsaved draft?",
          description: "Reload the note from disk and replace your draft.",
          actions: [{ id: "cancel", label: "Cancel", role: "cancel" }, { id: "reload", label: "Discard and Reload", role: "destructive" }],
          closeOnEscape: true,
        });
        if (result.action !== "reload" || paneByKey(pane.key)?.draft !== pane.draft) return;
      } catch (error) {
        libraryError.set(String(error));
        return;
      } finally {
        confirming.set(false);
      }
    }
    await reloadPane(pane, epoch, true);
  }

  async function savePane(key: number, viewAfter: boolean) {
    const pane = paneByKey(key);
    if (!pane?.editing || !pane.note || pane.saving || pane.updating) return;
    if (!dirty(pane)) {
      if (viewAfter) finishEdit(key);
      return;
    }
    const epoch = generation;
    const source = pane.draft!;
    patchPane(key, { saving: true, problem: undefined });
    try {
      const saved: Reading = JSON.parse(await Reader.saveNote(pane.id, source, pane.note.revision));
      const live = paneByKey(key);
      if (epoch !== generation || !live) return;
      const newer = live.draft !== source;
      patchPane(key, { note: saved, draft: newer ? live.draft : undefined, external: false });
      if (viewAfter && !newer) finishEdit(key);
    } catch (error) {
      if (epoch === generation) patchPane(key, { problem: `Could not save: ${error}` });
    } finally {
      if (epoch === generation) {
        patchPane(key, { saving: false });
        refreshAfterSave = true;
      }
    }
  }

  function finishEdit(key: number) {
    patchPane(key, { editing: false, draft: undefined });
    if (editorFocused() === key) editorFocused.set(null);
    editors.delete(key);
    selections.delete(key);
  }

  function toggleEdit(key = activeKey()) {
    if (key === null) return;
    const pane = paneByKey(key);
    if (!pane?.note || pane.saving || pane.updating || busy()) return;
    if (pane.editing) void savePane(key, true);
    else patchPane(key, { editing: true });
  }

  function canLeaveLibrary() {
    if (operation()) { libraryError.set("Wait for the library operation to finish."); return false; }
    if (!panes().some((pane) => dirty(pane) || pane.saving)) return true;
    libraryError.set("Save or discard your drafts before switching libraries or quitting.");
    return false;
  }

  function neighbor(offset: number) {
    const current = panes().findIndex((pane) => pane.key === activeKey());
    return current < 0 ? undefined : panes()[current + offset];
  }

  function focusNeighbor(offset: number) {
    const target = neighbor(offset);
    if (target) activate(target.key);
  }

  function movePane(offset: number) {
    const target = neighbor(offset);
    if (!target) return;
    const order = [...panes()];
    const current = order.findIndex((pane) => pane.key === activeKey());
    [order[current], order[current + offset]] = [order[current + offset], order[current]];
    panes.set(order);
    reveal.set(reveal() + 1);
  }

  async function closePane() {
    const pane = activePane();
    if (!pane || pane.saving || busy()) return;
    if (dirty(pane)) {
      confirming.set(true);
      try {
        const { action } = await AlertDialog.show({
          title: "Discard unsaved draft?",
          actions: [{ id: "cancel", label: "Cancel", role: "cancel" }, { id: "discard", label: "Discard and Close", role: "destructive" }],
          closeOnEscape: true,
        });
        const live = paneByKey(pane.key);
        if (action !== "discard" || !live || live.saving || live.draft !== pane.draft) return;
      } catch (error) {
        libraryError.set(String(error));
        return;
      } finally {
        confirming.set(false);
      }
    }
    removePane(pane.key);
  }

  function removePane(key: number) {
    const position = panes().findIndex((item) => item.key === key);
    if (position < 0) return;
    if (editorFocused() === key) editorFocused.set(null);
    editors.delete(key);
    selections.delete(key);
    const remaining = panes().filter((item) => item.key !== key);
    panes.set(remaining);
    if (activeKey() === key) activeKey.set((remaining[position] ?? remaining[position - 1])?.key ?? null);
    reveal.set(reveal() + 1);
  }

  function findNotes() {
    if (path() && !opening() && !syncing()) overlay.set("notes");
  }

  function canInsert() {
    const pane = activePane();
    return !!pane?.editing && pane.note?.entry.kind === "typst" && !pane.saving && !busy();
  }

  function chooseLink() {
    const pane = activePane();
    if (!pane?.note || !canInsert()) return;
    const source = pane.draft ?? pane.note.source;
    const selection = selections.get(pane.key) ?? { start: 0, end: 0 };
    pendingLink = { start: Math.min(selection.start, source.length), end: Math.min(selection.end, source.length), key: pane.key, source };
    overlay.set("link");
  }

  function focusEditor(key: number, range?: Selection) {
    requestAnimationFrame(() => {
      const editor = editors.get(key);
      if (!editor || activeKey() !== key || !paneByKey(key)?.editing || overlay()) return;
      editor.focus();
      if (range) {
        selections.set(key, range);
        editor.setSelection(range.start, range.end);
      }
    });
  }

  function insertLink(id: string) {
    const pending = pendingLink;
    pendingLink = undefined;
    const target = index().entries.find((entry) => entry.id === id);
    if (!pending || !target) return;
    const pane = paneByKey(pending.key);
    if (!pane?.editing || !pane.note || pane.saving || (pane.draft ?? pane.note.source) !== pending.source) {
      libraryError.set("The source changed while choosing a link. Insert the link again.");
      return;
    }
    const label = pending.source.slice(pending.start, pending.end) || target.title_markup || target.title;
    const link = target.kind === "literature" ? `@${target.id}` : `#link("dox:${target.id}")[${label}]`;
    setDraft(pane.key, pending.source.slice(0, pending.start) + link + pending.source.slice(pending.end));
    const end = pending.start + link.length;
    focusEditor(pane.key, { start: end, end });
  }

  function closeLinkPicker() {
    overlay.set(null);
    const pending = pendingLink;
    // The picker also closes immediately before it calls onSelect.
    queueMicrotask(() => {
      if (!pending || pendingLink !== pending) return;
      pendingLink = undefined;
      focusEditor(pending.key, pending);
    });
  }

  function showReading(note: Reading, editing = false, selectTitle = false) {
    const id = note.entry.id;
    const existing = panes().find((pane) => pane.id === id);
    if (existing) {
      activate(existing.key, true);
      if (existing.editing) focusEditor(existing.key);
      return;
    }
    const key = newPane(id, { note, editing, problem: note.warning ?? undefined });
    const entries = index().entries;
    if (!entries.some((entry) => entry.id === id)) index.set({ ...index(), entries: [note.entry, ...entries] });
    if (editing) {
      const title = selectTitle ? /^= (Untitled)\s*$/m.exec(note.source) : null;
      const end = title ? title.index + 2 + title[1].length : note.source.length;
      focusEditor(key, { start: title ? title.index + 2 : end, end });
    }
  }

  async function withOperation<T>(label: string, job: () => Promise<T>): Promise<T> {
    if (!path() || busy()) throw new Error("Another library operation is in progress.");
    operation.set(label);
    libraryError.set("");
    try { return await job(); }
    finally { operation.set(""); }
  }

  async function report(job: () => Promise<void>) {
    try { await job(); }
    catch (error) { libraryError.set(String(error)); }
  }

  function canDelete() {
    const pane = activePane();
    return !!pane?.note && !pane.saving && !pane.updating && !busy();
  }

  async function deleteNote() {
    const pane = activePane();
    if (!pane?.note || !canDelete()) return;
    confirming.set(true);
    let confirmed = false;
    try {
      const { action } = await AlertDialog.show({
        title: "Delete note?",
        description: `Move “${pane.note.entry.title}” to the library trash.`,
        actions: [{ id: "cancel", label: "Cancel", role: "cancel" }, { id: "delete", label: "Delete", role: "destructive" }],
        closeOnEscape: true,
      });
      confirmed = action === "delete";
    } finally { confirming.set(false); }
    const current = paneByKey(pane.key);
    if (!confirmed || !current || current.note?.revision !== pane.note.revision || current.updating) return;
    await withOperation("Deleting note…", async () => {
      if (dirty(current)) await savePane(current.key, false);
      const live = paneByKey(current.key);
      if (!live?.note || dirty(live) || live.saving) throw new Error("Delete stopped because the draft could not be saved.");
      const trashEntry = await Reader.deleteNote(live.id, live.note.revision);
      lastDeleted.set(trashEntry);
      removePane(live.key);
      index.set({ ...index(), entries: index().entries.filter((entry) => entry.id !== live.id) });
      refreshAfterSave = true;
    });
  }

  async function restoreNote() {
    const entry = lastDeleted();
    if (!entry || busy()) return;
    await withOperation("Restoring note…", async () => {
      const note: Reading = JSON.parse(await Reader.restoreNote(entry));
      lastDeleted.set(null);
      const existing = panes().find((pane) => pane.id === note.entry.id);
      if (existing && !dirty(existing)) {
        patchPane(existing.key, { note, error: undefined, problem: undefined, external: false });
      }
      showReading(note);
      refreshAfterSave = true;
    });
  }

  async function createNote(kind: "note" | "daily" | "literature") {
    await withOperation("Opening note…", async () => {
      const note: Reading = JSON.parse(await Reader.createNote(kind));
      showReading(note, true, kind === "note");
      refreshAfterSave = true;
    });
  }

  async function importItem(load: () => Promise<string | null | undefined>) {
    await withOperation("Importing…", async () => {
      const result = await load();
      if (result == null) return;
      showReading(JSON.parse(result));
      refreshAfterSave = true;
    });
  }

  function updateAttachments(key: number, response: string | null | undefined) {
    if (response == null) return;
    const result: Reading = JSON.parse(response);
    const live = paneByKey(key);
    if (!live?.note) return;
    // Attachment updates must not advance a draft's saved revision.
    patchPane(key, { note: { ...live.note, attachments: result.attachments }, problem: result.warning ?? undefined });
    refreshAfterSave = true;
  }

  async function attach(key: number) {
    const pane = paneByKey(key);
    if (!pane?.note) return;
    await withOperation("Attaching files…", async () => { updateAttachments(key, await Reader.addAttachments(pane.id)); });
  }

  async function removeAttachment(key: number, name: string) {
    const pane = paneByKey(key);
    if (!pane?.note || busy()) return;
    confirming.set(true);
    let action: string | null | undefined;
    try {
      ({ action } = await AlertDialog.show({ title: "Remove attachment?", description: `Remove the library’s copy of ${name}.`,
        actions: [{ id: "cancel", label: "Cancel", role: "cancel" }, { id: "remove", label: "Remove", role: "destructive" }], closeOnEscape: true }));
    } finally { confirming.set(false); }
    if (action === "remove") await withOperation("Removing attachment…", async () => {
      updateAttachments(key, await Reader.removeAttachment(pane.id, name));
    });
  }

  function canSync() {
    return !busy() && !refreshing() && !panes().some((pane) => pane.saving || pane.updating);
  }

  async function toggleAutomaticSync() {
    const root = path();
    if (!root || busy() || (!automatic() && !git()?.upstream)) return;
    const enabled = !automatic();
    automatic.set(enabled);
    if (enabled) nextAutoSyncAt = Date.now() + AUTO_SYNC_IDLE;
    try {
      await Storage.setItem(autoSyncKey(root), String(enabled));
    } catch (error) {
      if (path() === root && automatic() === enabled) automatic.set(!enabled);
      throw error;
    }
  }

  async function syncNow() {
    if (!canSync()) return;
    await withOperation("Syncing…", async () => {
      syncError.set("");
      try {
        for (const pane of panes()) {
          if (dirty(pane)) await savePane(pane.key, false);
        }
        if (panes().some((pane) => dirty(pane) || pane.saving)) throw new Error("Sync stopped because not all drafts could be saved.");
        await Reader.syncLibrary();
      } catch (error) {
        syncError.set(error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        nextAutoSyncAt = Date.now() + AUTO_SYNC_INTERVAL;
        refreshAfterSave = true;
      }
    });
  }

  function runCommand(id: string) {
    overlay.set(null);
    switch (id) {
      case "open": void openLibrary(); break;
      case "find": findNotes(); break;
      case "new": void report(() => createNote("note")); break;
      case "daily": void report(() => createNote("daily")); break;
      case "literature": void report(() => createNote("literature")); break;
      case "link": chooseLink(); break;
      case "attach": { const key = activeKey(); if (key !== null) void report(() => attach(key)); break; }
      case "pdf": {
        const pane = activePane();
        if (pane?.note?.entry.kind === "literature") void report(() => withOperation("Finding PDF…", async () => {
          updateAttachments(pane.key, await Reader.findPaperPdf(pane.id, pane.draft));
        }));
        break;
      }
      case "publication": overlay.set("publication"); break;
      case "bibtex": void report(() => importItem(() => Reader.importBibtex())); break;
      case "sync": void report(syncNow); break;
      case "auto-sync": void report(toggleAutomaticSync); break;
      case "refresh": void refresh(generation); break;
      case "edit": toggleEdit(); break;
      case "save": { const key = activeKey(); if (key !== null) void savePane(key, false); break; }
      case "reload": void confirmReload(); break;
      case "close": void closePane(); break;
      case "delete": void report(deleteNote); break;
      case "restore": void report(restoreNote); break;
      case "previous": focusNeighbor(-1); break;
      case "next": focusNeighbor(1); break;
      case "move-left": movePane(-1); break;
      case "move-right": movePane(1); break;
      case "diagnostics": diagnosticsOpen.set(!diagnosticsOpen()); break;
    }
  }

  const poll = setInterval(() => {
    if (!path() || busy() || refreshing() || panes().some((pane) => pane.saving)) return;
    const version = Reader.changeVersion();
    if (version !== seenChanges || refreshAfterSave) {
      seenChanges = version;
      refreshAfterSave = false;
      void refresh(generation);
      return;
    }
    const now = Date.now();
    if (automatic() && git()?.upstream && !overlay() && canSync() &&
        now >= nextAutoSyncAt && now - lastEditAt >= AUTO_SYNC_IDLE) {
      void report(syncNow);
    }
  }, 500);
  const stopQuit = Application.on("quitRequest", () => {
    if (canLeaveLibrary()) Application.quit();
    else Application.cancelQuitRequest();
  });
  const stopClose = window.on("closePress", () => {
    if (canLeaveLibrary()) window.close();
  });
  Application.setQuitRequestOptions({ system: true });
  cleanup(() => { clearInterval(poll); stopClose(); stopQuit(); });
  void openLibrary(true);

  keymap.bind({
    "mod+o": () => { if (!overlay()) void openLibrary(); },
    "mod+n": () => { if (path() && !busy() && !overlay()) void report(() => createNote("note")); },
    "mod+shift+d": () => { if (path() && !busy() && !overlay()) void report(() => createNote("daily")); },
    "mod+k": () => { if (!overlay()) chooseLink(); },
    "mod+p": () => { if (overlay() === "notes") overlay.set(null); else if (!overlay()) findNotes(); },
    "mod+shift+p": () => { if (overlay() === "commands") overlay.set(null); else if (!overlay()) overlay.set("commands"); },
  }, { when: "always" });
  effect(() => {
    if (overlay() || confirming() || operation() || (activeKey() === null && !libraryError())) return;
    return keymap.bind({
      escape: () => {
        if (libraryError()) libraryError.set("");
        else if (activePane()?.editing) toggleEdit();
        else void closePane();
      },
      "mod+w": () => void closePane(),
      "mod+s": () => { const key = activeKey(); if (key !== null) void savePane(key, false); },
    }, { when: "always" });
  });
  effect(() => {
    if (overlay() || confirming() || activeKey() === null || editorFocused() !== null) return;
    return keymap.bind({
      e: () => toggleEdit(),
      d: () => void report(deleteNote),
      j: () => focusNeighbor(-1), left: () => focusNeighbor(-1),
      k: () => focusNeighbor(1), right: () => focusNeighbor(1),
      "shift+j": () => movePane(-1), "shift+left": () => movePane(-1),
      "shift+k": () => movePane(1), "shift+right": () => movePane(1),
    }, { when: "always" });
  });

  return (
    <View class="flex-1 bg-background">
      <View desktop={{ windowDrag: true }} style={{ height: titleBar().height }} class="shrink-0 border-b border-border bg-muted" />
      <If when={libraryError()}>
        <View class="flex-row items-center border-b border-border px-2 py-1">
          <Text class="flex-1 text-xs text-foreground">{libraryError()}</Text>
          <IconButton icon="close" label="Dismiss message" onPress={() => libraryError.set("")} />
        </View>
      </If>
      <If when={watchError()}><Text class="border-b border-border px-2 py-1 text-xs text-muted-foreground">{watchError()}</Text></If>
      <Workspace panes={panes()} spareKey={spareKey()} activeKey={activeKey()} reveal={reveal()} entries={index().entries}
        onActivate={activate} onNavigate={(id) => void openNote(id)} onEdit={toggleEdit} onDraft={setDraft}
        actions={{ busy: busy(), locked: syncing() || opening() || operation() === "Deleting note…", onEditor: (key, editor) => editors.set(key, editor),
          onSelection: (key, selection) => selections.set(key, selection),
          onAttach: (key) => void report(() => attach(key)),
          onDropAttachments: (key, uris) => {
            const pane = paneByKey(key);
            if (!pane || !uris.length || busy()) return;
            void report(() => withOperation("Attaching files…", async () => {
              updateAttachments(key, await Reader.dropAttachments(pane.id, uris));
            }));
          },
          onOpenAttachment: (key, name) => { const pane = paneByKey(key); if (pane) void report(() => Reader.openAttachment(pane.id, name)); },
          onRemoveAttachment: (key, name) => void report(() => removeAttachment(key, name)) }}
        onEditorFocus={(key, focused) => {
          if (focused) { editorFocused.set(key); activate(key); }
          else if (editorFocused() === key) editorFocused.set(null);
        }} />
      <If when={index().diagnostics.length > 0}>
        <View class="shrink-0 border-t border-border">
          <Button class="px-2 py-1 hover:bg-muted"
            accessibilityLabel={`${diagnosticsOpen() ? "Collapse" : "Expand"} diagnostics (${index().diagnostics.length})`}
            onPress={() => diagnosticsOpen.set(!diagnosticsOpen())}>
            <Text class="text-xs text-muted-foreground">DIAGNOSTICS · {index().diagnostics.length}</Text>
          </Button>
          <If when={diagnosticsOpen()}>
            <Scroll style={{ maxHeight: 140 }}>
              <Each of={index().diagnostics} key={(issue) => issue.id}>
                {(issue) => <Button class="border-t border-border px-2 py-1 hover:bg-muted" disabled={!issue().note_id}
                  onPress={() => { const id = issue().note_id; if (id) void openNote(id); }}>
                  <Text class="text-xs text-foreground">{issue().severity.toUpperCase()}{issue().note_id ? ` · ${issue().note_id}` : ""} · {issue().message}</Text>
                </Button>}
              </Each>
            </Scroll>
          </If>
        </View>
      </If>
      <View accessibilityLabel="Status bar" style={{ height: 22 }} class="shrink-0 flex-row items-center gap-2 border-t border-border bg-muted px-2">
        <If when={path()} else={
          <Button onPress={() => overlay.set("commands")}><Text class="text-xs text-muted-foreground">⌘⇧P · Open library</Text></Button>
        }>
          <View class="min-w-0 flex-row items-center" tooltip={path()}>
            <Text class="min-w-0 shrink text-xs text-muted-foreground line-clamp-1" style={{ textOverflow: "ellipsis-start" }}>{parentPath()}</Text>
            <Text class="shrink-0 text-xs text-foreground line-clamp-1">{folderName()}</Text>
          </View>
        </If>
        <If when={!syncing() && (operation() || opening() || refreshing())}><Text class="shrink-0 text-xs text-muted-foreground">{operation() || (opening() ? "Opening…" : "Indexing…")}</Text></If>
        <If when={gitStatus()}>{(status) => (
          <View class="ml-auto shrink-0 flex-row items-center gap-1" accessibilityLabel={status().description}
            tooltip={<Tooltip align="end" class="rounded-md border border-border bg-background px-2 py-1.5" style={{ maxWidth: 320 }}>
              <Text class="text-xs text-foreground">{status().details}</Text>
            </Tooltip>}>
            <Icon name={status().icon} size={13} />
            <If when={!automatic()}><Icon name="pause" size={12} /></If>
            <Text class="text-xs text-muted-foreground">{status().branch}</Text>
          </View>
        )}</If>
      </View>
      <If when={overlay() === "commands"}>
        <Picker title="Command panel" placeholder="Find command…" items={commands()} onSelect={runCommand} onClose={() => overlay.set(null)} />
      </If>
      <If when={overlay() === "notes"}>
        <Picker title="Find note" placeholder="Find note…" items={noteItems()} onSelect={(id) => { overlay.set(null); void openNote(id); }} onClose={() => overlay.set(null)} />
      </If>
      <If when={overlay() === "link"}>
        <Picker title="Insert link or citation" placeholder="Link or cite…" items={noteItems()} onSelect={insertLink} onClose={closeLinkPicker} />
      </If>
      <If when={overlay() === "publication"}>
        <PublicationDialog onImport={(query) => importItem(() => Reader.importPublication(query))} onClose={() => overlay.set(null)} />
      </If>
    </View>
  );
}

mount(App);
