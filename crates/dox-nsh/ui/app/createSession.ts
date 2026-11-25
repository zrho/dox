import { batch, cleanup, computed, signal, Storage } from "nsh";
import { AlertDialog } from "nsh/base";
import type { InputRef } from "nsh/types";
import { Reader } from "dox-nsh/native";
import { dirty, type Pane, type PaneActions, type Reading, type Selection } from "../workspace/paneState";
import type { GitSummary, Index, Opened } from "./sessionTypes";

const emptyIndex: Index = { entries: [], diagnostics: [] };
const LIBRARY_KEY = "dox.library";
const AUTO_SYNC_IDLE = 10 * 60_000;
const AUTO_SYNC_INTERVAL = 5 * 60_000;
const autoSyncKey = (root: string) => `dox.git.automatic:${root}`;

export function createSession() {
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

  function refreshIndex() {
    return refresh(generation);
  }

  function findPaper(pane: Pane) {
    return withOperation("Finding PDF…", async () => {
      updateAttachments(pane.key, await Reader.findPaperPdf(pane.id, pane.draft));
    });
  }

  const importBibtex = () => importItem(() => Reader.importBibtex());
  const importPublication = (query: string) => importItem(() => Reader.importPublication(query));

  function paneActions(): PaneActions {
    return {
      busy: busy(),
      locked: syncing() || opening() || operation() === "Deleting note…",
      onEditor: (key, editor) => editors.set(key, editor),
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
      onRemoveAttachment: (key, name) => void report(() => removeAttachment(key, name)),
    };
  }

  function onEditorFocus(key: number, focused: boolean) {
    if (focused) { editorFocused.set(key); activate(key); }
    else if (editorFocused() === key) editorFocused.set(null);
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
  cleanup(() => clearInterval(poll));

  return {
    path, index, git, panes, activeKey, reveal, overlay, diagnosticsOpen, automatic,
    opening, refreshing, libraryError, watchError, confirming, editorFocused, activePane,
    operation, syncError, lastDeleted, syncing, busy, spareKey,
    openLibrary, activate, openNote, savePane, toggleEdit, canLeaveLibrary, neighbor,
    focusNeighbor, movePane, closePane, findNotes, canInsert, chooseLink, insertLink,
    closeLinkPicker, report, canDelete, deleteNote, restoreNote, createNote, attach,
    canSync, toggleAutomaticSync, syncNow, confirmReload, setDraft,
    refreshIndex, findPaper, importBibtex, importPublication, paneActions, onEditorFocus,
  };
}

export type Session = ReturnType<typeof createSession>;
