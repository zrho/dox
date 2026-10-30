import { batch, createMemo, createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  commandDefinitions,
  type CommandId,
  type UICommand,
} from "../utils/commands";
import { titleText } from "../components/features/NoteTitle";
import type {
  Note,
  Document,
  Index,
  DeletedNote,
  Diagnostic,
  NoteColumn,
  NotePickerMode,
} from "../types";
import { createDesktopLifecycle } from "./createDesktopLifecycle";
const defaultZoom = { editorZoom: 100, viewZoom: 90 };
export function createLibrarySession() {
  const [library, setLibrary] = createSignal("");
  const [sidebarVisible, setSidebarVisible] = createSignal(false);
  // Reconcile by ID so refreshed JSON updates fields without replacing tree rows.
  const [libraryIndex, updateIndex] = createStore<Index>({
    notes: [],
    warnings: [],
    diagnostics: [],
  });
  const index = () => libraryIndex;
  function setIndex(next: Index | ((previous: Index) => Index)) {
    updateIndex(
      reconcile(typeof next === "function" ? next(libraryIndex) : next, {
        key: "id",
      }),
    );
  }
  const [workspace, setWorkspace] = createStore<{ columns: NoteColumn[] }>({
    columns: [],
  });
  const [activeKey, setActiveKey] = createSignal<number>();
  const [columnReveal, setColumnReveal] = createSignal(0);
  let nextColumnKey = 0;
  const columns = () => workspace.columns;
  const activeColumn = () =>
    columns().find((column) => column.key === activeKey());
  const current = () => activeColumn()?.document;
  const source = () => activeColumn()?.source ?? "";
  const mode = () => activeColumn()?.mode ?? "view";
  const html = () => activeColumn()?.html ?? "";
  const editorZoom = () => activeColumn()?.editorZoom ?? defaultZoom.editorZoom;
  const viewZoom = () => activeColumn()?.viewZoom ?? defaultZoom.viewZoom;
  const external = () => activeColumn()?.external ?? false;
  const editors = new Map<number, HTMLTextAreaElement>();
  const editor = () =>
    activeKey() === undefined ? undefined : editors.get(activeKey()!);
  function updateColumn(key: number, patch: Partial<NoteColumn>) {
    setWorkspace("columns", (column) => column.key === key, patch);
  }
  function updateActive(patch: Partial<NoteColumn>) {
    const key = activeKey();
    if (key !== undefined) updateColumn(key, patch);
  }
  const setCurrent = (document: Document) => updateActive({ document });
  const setSource = (source: string) => updateActive({ source });
  const setMode = (mode: "view" | "edit") => updateActive({ mode });
  const setHtml = (html: string) => updateActive({ html });
  const setExternal = (external: boolean) => updateActive({ external });
  function addColumn(
    document: Document,
    html: string,
    mode: "view" | "edit" = "view",
    prefix = columns().length,
  ) {
    const column: NoteColumn = {
      key: ++nextColumnKey,
      document,
      source: document.source,
      html,
      mode,
      external: false,
      editorZoom: editorZoom(),
      viewZoom: viewZoom(),
    };
    const kept = columns().slice(0, prefix);
    for (const old of columns().slice(prefix)) editors.delete(old.key);
    batch(() => {
      setWorkspace("columns", [...kept, column]);
      setActiveKey(column.key);
    });
    queueMicrotask(focusActive);
    return column.key;
  }
  function focusActive() {
    if (mode() === "edit") editor()?.focus();
    else main?.focus();
  }
  function revealColumn(key: number) {
    batch(() => {
      setActiveKey(key);
      setColumnReveal((request) => request + 1);
    });
    queueMicrotask(focusActive);
  }
  const columnDirty = (column: NoteColumn) =>
    column.source !== column.document.source;
  const anyDirty = () => columns().some(columnDirty);
  function confirmDiscard(removed: NoteColumn[]) {
    return (
      !removed.some(columnDirty) ||
      window.confirm("Discard unsaved drafts in the columns being closed?")
    );
  }
  function activateColumn(key: number) {
    if (!busy() && columns().some((column) => column.key === key))
      setActiveKey(key);
  }
  function moveColumn(key: number, destination: number) {
    if (busy()) return;
    const reordered = [...columns()];
    const from = reordered.findIndex((column) => column.key === key);
    if (from < 0) return;
    const to = Math.max(0, Math.min(reordered.length - 1, destination));
    if (from === to) return;
    const [column] = reordered.splice(from, 1);
    reordered.splice(to, 0, column);
    setWorkspace("columns", reordered);
  }
  function removeColumn(key: number) {
    const position = columns().findIndex((column) => column.key === key);
    const remaining = columns().filter((column) => column.key !== key);
    editors.delete(key);
    batch(() => {
      setWorkspace("columns", remaining);
      if (activeKey() === key)
        setActiveKey(remaining[Math.min(position, remaining.length - 1)]?.key);
    });
  }
  function closeColumn(key: number) {
    if (busy()) return;
    const column = columns().find((column) => column.key === key);
    if (!column || !confirmDiscard([column])) return;
    removeColumn(key);
    queueMicrotask(() => {
      if (mode() === "edit") editor()?.focus();
      else main?.focus();
    });
  }
  function zoomContent(change: number | "reset") {
    const field = mode() === "edit" ? "editorZoom" : "viewZoom";
    const value = activeColumn()?.[field] ?? defaultZoom[field];
    updateActive({
      [field]:
        change === "reset" ? defaultZoom[field] : Math.max(50, Math.min(250, value + change)),
    });
  }
  const [error, setError] = createSignal("");
  const [lastDeleted, setLastDeleted] = createSignal<DeletedNote>();
  const [busy, setBusy] = createSignal(false);
  const [commandPanelOpen, setCommandPanelOpen] = createSignal(false);
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pickerMode, setPickerMode] = createSignal<NotePickerMode>("open");
  const [publicationImportOpen, setPublicationImportOpen] = createSignal(false);
  const dirty = createMemo(() => !!current() && source() !== current()!.source);
  const pinnedNotes = createMemo(() =>
    index().notes.filter((note) => note.metadata.pinned === true),
  );
  let sidebar: HTMLElement | undefined;
  let main: HTMLElement | undefined;
  let pendingLink:
    | {
        noteId: string;
        source: string;
        start: number;
        end: number;
      }
    | undefined;
  let editPosition:
    | {
        noteId: string;
        start: number;
        end: number;
        scrollTop: number;
      }
    | undefined;
  let request = 0;
  let indexRequest = 0;
  async function run(action: () => Promise<void>) {
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function toggleSidebar() {
    const hiding = sidebarVisible();
    const moveFocus = hiding && sidebar?.contains(document.activeElement);
    setSidebarVisible(!hiding);
    if (moveFocus)
      queueMicrotask(() => {
        if (mode() === "edit" && editor()?.isConnected) editor()!.focus();
        else main?.focus();
      });
  }
  function closeFocused() {
    if (sidebarVisible() && sidebar?.contains(document.activeElement)) {
      toggleSidebar();
      return;
    }
    const key = activeKey();
    if (key !== undefined) closeColumn(key);
  }
  async function refresh() {
    const token = ++indexRequest;
    const root = library();
    const result = await invoke<Index>("list_notes");
    if (token === indexRequest && root === library()) setIndex(result);
  }
  async function openLibrary(path: string) {
    ++indexRequest;
    const root = await invoke<string>("open_library", { path });
    ++request;
    setLibrary(root);
    setLastDeleted(undefined);
    setWorkspace("columns", []);
    setActiveKey(undefined);
    editors.clear();
    setIndex({ notes: [], warnings: [], diagnostics: [] });
    localStorage.setItem("dox.library", root);
    setIndex(await invoke<Index>("cached_notes"));
    // Let the tree and note commands work while fresh metadata is built.
    void refresh().catch((error) => {
      if (library() === root) setError(String(error));
    });
  }
  async function readColumn(id: string, columnMode: "view" | "edit" = "view") {
    const document = await invoke<Document>("read_note", { id });
    const html =
      columnMode === "view" && !document.note.diagnostic
        ? await invoke<string>("render_note", { id })
        : "";
    return { document, html };
  }
  async function openPickedNote(id: string) {
    const focused = activeColumn();
    const existing = focused?.document.note.id === id
      ? focused
      : columns().find((column) => column.document.note.id === id);
    if (existing) {
      revealColumn(existing.key);
      return;
    }
    const token = ++request;
    const result = await readColumn(id);
    if (token === request) addColumn(result.document, result.html);
  }
  async function load(id: string, force = false) {
    const existing = columns().find((column) => column.document.note.id === id);
    if (existing && !force) {
      revealColumn(existing.key);
      return;
    }
    if (!force && !confirmDiscard(columns())) return;
    const token = ++request;
    const result = await readColumn(
      id,
      force && existing ? existing.mode : "view",
    );
    if (token !== request) return;
    if (force && existing) {
      updateColumn(existing.key, {
        ...result,
        source: result.document.source,
        external: false,
      });
    } else addColumn(result.document, result.html, "view", 0);
  }
  async function openLinked(id: string, fromKey: number) {
    const from = columns().findIndex((column) => column.key === fromKey);
    if (from < 0) return;
    const existing = columns().find((column) => column.document.note.id === id);
    if (existing) {
      revealColumn(existing.key);
      return;
    }
    if (!confirmDiscard(columns().slice(from + 1))) return;
    const token = ++request;
    const result = await readColumn(id);
    if (token === request)
      addColumn(result.document, result.html, "view", from + 1);
  }
  async function preview(id: string, token = request) {
    if (current()?.note.id === id && current()?.note.diagnostic) {
      setHtml("");
      return;
    }
    const rendered = await invoke<string>("render_note", { id });
    if (token === request && current()?.note.id === id) setHtml(rendered);
  }
  async function chooseLibrary() {
    if (
      anyDirty() &&
      !window.confirm("Discard unsaved drafts and switch libraries?")
    )
      return;
    const path = await open({
      directory: true,
      multiple: false,
      title: "Open or create a dox library",
    });
    if (!path) return;
    await openLibrary(path);
  }
  async function save() {
    if (!current()) return;
    ++indexRequest;
    const doc = await invoke<Document>("save_note", {
      id: current()!.note.id,
      source: source(),
      revision: current()!.note.revision,
    });
    setCurrent(doc);
    setSource(doc.source);
    setExternal(false);
    // Show save-time diagnostics immediately, even before the library refresh finishes.
    setIndex((previous) => ({
      ...previous,
      notes: previous.notes.map((note) =>
        note.id === doc.note.id ? doc.note : note,
      ),
      diagnostics: [
        ...previous.diagnostics.filter(
          (issue) => issue.note_id !== doc.note.id,
        ),
        ...doc.note.diagnostics,
      ],
    }));
    await refresh();
  }
  async function togglePin() {
    const active = current();
    if (!active) return;
    ++indexRequest;
    const doc = await invoke<Document>("set_note_pinned", {
      id: active.note.id,
      pinned: active.note.metadata.pinned !== true,
      revision: active.note.revision,
    });
    // Only the saved baseline changes. Keep any unsaved editor draft intact.
    setCurrent(doc);
    setExternal(false);
    setIndex((previous) => ({
      ...previous,
      notes: previous.notes.map((note) =>
        note.id === doc.note.id ? doc.note : note,
      ),
      diagnostics: [
        ...previous.diagnostics.filter(
          (issue) => issue.note_id !== doc.note.id,
        ),
        ...doc.note.diagnostics,
      ],
    }));
    await refresh();
  }
  async function deleteCurrent() {
    if (!current()) return;
    if (dirty()) await save();
    const id = current()!.note.id;
    ++indexRequest;
    const deleted = await invoke<DeletedNote>("delete_note", {
      id,
      revision: current()!.note.revision,
    });
    ++request;
    const column = columns().find((column) => column.document.note.id === id);
    if (column) removeColumn(column.key);
    setPickerOpen(false);
    pendingLink = undefined;
    editPosition = undefined;
    setLastDeleted(deleted);
    await refresh();
  }
  async function undoDelete() {
    const deleted = lastDeleted();
    if (!deleted) return;
    if (dirty()) await save();
    ++indexRequest;
    const doc = await invoke<Document>("restore_note", {
      trashEntry: deleted.trash_entry,
    });
    const rendered =
      mode() === "view" && !doc.note.diagnostic
        ? await invoke<string>("render_note", { id: doc.note.id })
        : "";
    ++request;
    const existing = columns().find(
      (column) => column.document.note.id === doc.note.id,
    );
    if (existing) {
      updateColumn(existing.key, {
        document: doc,
        source: doc.source,
        html: rendered,
      });
      setActiveKey(existing.key);
    } else addColumn(doc, rendered, mode());
    setLastDeleted(undefined);
    await refresh();
  }
  async function openDiagnostic(diagnostic: Diagnostic) {
    if (!diagnostic.note_id) return;
    if (current()?.note.id !== diagnostic.note_id)
      await load(diagnostic.note_id);
    if (current()?.note.id !== diagnostic.note_id) return;
    edit();
    queueMicrotask(() => {
      if (!editor()) return;
      let position = 0;
      const ownDocument = current()?.note.metadata.document;
      const notePath = `${current()?.note.id}/${ownDocument}`;
      const isOwnDocument =
        diagnostic.document === ownDocument ||
        diagnostic.document === notePath ||
        diagnostic.document?.endsWith(`/${notePath}`);
      if (diagnostic.line && isOwnDocument) {
        const lines = source().split("\n");
        const line = Math.max(
          0,
          Math.min(diagnostic.line - 1, lines.length - 1),
        );
        position =
          lines
            .slice(0, line)
            .reduce((length, text) => length + text.length + 1, 0) +
          Math.min((diagnostic.column ?? 1) - 1, lines[line].length);
      } else if (diagnostic.target_note_id) {
        position = Math.max(
          0,
          source().indexOf(`dox:${diagnostic.target_note_id}`),
        );
      }
      editor()!.focus();
      editor()!.setSelectionRange(position, position);
      const lineHeight =
        parseFloat(getComputedStyle(editor()!).lineHeight) || 20;
      editor()!.scrollTop = Math.max(
        0,
        (source().slice(0, position).split("\n").length - 3) * lineHeight,
      );
    });
  }
  async function view() {
    if (!current()) return;
    if (mode() === "edit" && editor() && current()) {
      editPosition = {
        noteId: current()!.note.id,
        start: editor()!.selectionStart,
        end: editor()!.selectionEnd,
        scrollTop: editor()!.scrollTop,
      };
    }
    if (dirty()) await save();
    // Keep the editor visible until the rendered result is ready.
    await preview(current()!.note.id);
    setMode("view");
  }
  function edit() {
    if (!current()) return;
    setMode("edit");
    queueMicrotask(() => {
      editor()?.focus();
      if (
        editor() &&
        editPosition &&
        editPosition.noteId === current()?.note.id
      ) {
        editor()!.setSelectionRange(editPosition.start, editPosition.end);
        editor()!.scrollTop = editPosition.scrollTop;
      }
    });
  }
  async function toggleMode() {
    if (!current()) return;
    if (mode() === "edit") await view();
    else edit();
  }
  function openPicker() {
    if (!library()) return;
    pendingLink = undefined;
    setPickerMode("open");
    setPickerOpen(true);
  }
  function openLinkPicker(withTitle = false) {
    if (current()?.note.metadata.type !== "typst") return;
    if (
      busy() ||
      !current() ||
      mode() !== "edit" ||
      !editor() ||
      document.activeElement !== editor()
    )
      return;
    pendingLink = {
      noteId: current()!.note.id,
      source: source(),
      start: editor()!.selectionStart,
      end: editor()!.selectionEnd,
    };
    setPickerMode(withTitle ? "insert-with-title" : "insert");
    setPickerOpen(true);
  }
  function selectNote(id: string) {
    if (pickerMode() === "open") {
      void run(() => openPickedNote(id));
      return;
    }
    const target = index().notes.find((note) => note.id === id);
    if (!target || !pendingLink) return;
    const selection = pendingLink;
    if (
      mode() !== "edit" ||
      current()?.note.id !== selection.noteId ||
      source() !== selection.source
    ) {
      setError(
        "The document changed while choosing a link. Insert the link again.",
      );
      return;
    }
    const label =
      selection.source.slice(selection.start, selection.end) || target.title;
    // Publication titles are bibliographic text, rather than Typst source.
    const publicationTitle = titleText(target)
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[\\#@[\]{}$*_`<>~=+.\/-]/g, "\\$&");
    const citation = pickerMode() === "insert-with-title"
      ? `${publicationTitle} @${target.id}`
      : `@${target.id}`;
    const link =
      target.metadata.type === "literature"
        ? citation
        : `#link("dox:${target.id}")[${label}]`;
    const updated =
      selection.source.slice(0, selection.start) +
      link +
      selection.source.slice(selection.end);
    const cursor = selection.start + link.length;
    setSource(updated);
    pendingLink = {
      ...selection,
      source: updated,
      start: cursor,
      end: cursor,
    };
  }
  function pickerCloseFocus(event: Event) {
    if (pickerMode() === "open") return;
    event.preventDefault();
    queueMicrotask(() => {
      const selection = pendingLink;
      if (
        editor() &&
        selection &&
        mode() === "edit" &&
        selection.noteId === current()?.note.id &&
        source() === selection.source
      ) {
        editor()!.focus();
        editor()!.setSelectionRange(selection.start, selection.end);
      }
      pendingLink = undefined;
    });
  }
  async function create(kind = "typst") {
    if (dirty()) await save();
    ++indexRequest;
    const doc = await invoke<Document>(
      kind === "literature" ? "create_literature" : "create_note",
    );
    ++request;
    addColumn(doc, "", "edit");
    setIndex((previous) => ({
      ...previous,
      notes: [doc.note, ...previous.notes],
    }));
    // The heading is ready to replace; typing starts without another click.
    queueMicrotask(() => {
      editor()?.focus();
      const start = doc.source.indexOf("Untitled");
      editor()?.setSelectionRange(start, start + 8);
    });
    await refresh();
  }
  async function copyReference() {
    const note = current()?.note;
    if (!note) return;
    await navigator.clipboard.writeText(
      note.metadata.type === "literature"
        ? `@${note.id}`
        : `#link("dox:${note.id}")[${note.title}]`,
    );
  }
  async function importPublication(input: string) {
    if (busy()) throw new Error("Another operation is in progress. Try again shortly.");
    setBusy(true);
    setError("");
    try {
      const doc = await invoke<Document>("import_publication", { input });
      ++indexRequest;
      ++request;
      // Append the imported item without disturbing any open drafts.
      const key = addColumn(doc, "", "edit");
      setIndex((previous) => ({ ...previous, notes: [doc.note, ...previous.notes] }));
      // Creation has succeeded. A later render/refresh failure must not invite
      // another import of the same item; leave its source available instead.
      try {
        const html = await invoke<string>("render_note", { id: doc.note.id });
        updateColumn(key, { html, mode: "view" });
        await refresh();
      } catch (error) {
        setError(String(error));
      }
    } finally {
      setBusy(false);
    }
  }
  const commandHandlers: Record<CommandId, () => void | Promise<void>> = {
    commands: () => {
      setCommandPanelOpen(true);
    },
    find: openPicker,
    close: closeFocused,
    "new-note": () => create(),
    "new-window": () => {
      void invoke<void>("new_window").catch((error) => setError(String(error)));
    },
    "new-literature": () => create("literature"),
    "import-publication": () => {
      setPublicationImportOpen(true);
    },
    "open-library": chooseLibrary,
    save,
    "toggle-mode": toggleMode,
    edit,
    view,
    insert: () => {
      editor()?.focus();
      openLinkPicker();
    },
    "insert-with-title": () => {
      editor()?.focus();
      openLinkPicker(true);
    },
    copy: copyReference,
    "toggle-sidebar": toggleSidebar,
    "toggle-pin": togglePin,
    "zoom-in": () => {
      zoomContent(10);
    },
    "zoom-out": () => {
      zoomContent(-10);
    },
    "zoom-reset": () => {
      zoomContent("reset");
    },
    delete: deleteCurrent,
    "undo-delete": undoDelete,
  };
  function commandEnabled(id: CommandId) {
    if (id === "new-window") return true;
    if (id === "zoom-in" || id === "zoom-out" || id === "zoom-reset")
      return !!current();
    if (busy()) return false;
    switch (id) {
      case "commands":
      case "open-library":
      case "toggle-sidebar":
        return true;
      case "find":
      case "new-note":
      case "new-literature":
      case "import-publication":
        return !!library();
      case "undo-delete":
        return !!lastDeleted();
      case "close":
        return !!current() || sidebarVisible();
      case "insert":
      case "insert-with-title":
        return (
          !!current() &&
          current()!.note.metadata.type === "typst" &&
          mode() === "edit"
        );
      case "save":
        return !!current() && dirty();
      default:
        return !!current();
    }
  }
  const commands = createMemo<UICommand[]>(() =>
    commandDefinitions.map((command) => ({
      ...command,
      title:
        command.id === "toggle-pin"
          ? current()?.note.metadata.pinned === true
            ? "Unpin item"
            : "Pin item"
          : command.title,
      enabled: commandEnabled(command.id),
    })),
  );
  function executeCommand(id: CommandId) {
    if (!commandEnabled(id)) return;
    if (id === "toggle-mode" && mode() === "view") {
      edit();
      return;
    }
    if (
      [
        "commands",
        "new-window",
        "import-publication",
        "find",
        "insert",
        "insert-with-title",
        "toggle-sidebar",
        "close",
        "edit",
        "zoom-in",
        "zoom-out",
        "zoom-reset",
      ].includes(id)
    ) {
      commandHandlers[id]();
    } else {
      void run(async () => {
        await commandHandlers[id]();
      });
    }
  }
  async function syncFromDisk() {
    await refresh();
    const root = library();
    for (const snapshot of [...columns()]) {
      if (root !== library()) return;
      if (
        !index().notes.some((note) => note.id === snapshot.document.note.id)
      ) {
        if (columnDirty(snapshot))
          updateColumn(snapshot.key, { external: true });
        else removeColumn(snapshot.key);
        continue;
      }
      const document = await invoke<Document>("read_note", {
        id: snapshot.document.note.id,
      });
      let column = columns().find((column) => column.key === snapshot.key);
      if (!column) continue;
      if (columnDirty(column)) {
        updateColumn(column.key, {
          external: document.note.revision !== column.document.note.revision,
        });
        continue;
      }
      const html =
        column.mode === "view" && !document.note.diagnostic
          ? await invoke<string>("render_note", { id: document.note.id })
          : column.html;
      column = columns().find((column) => column.key === snapshot.key);
      if (!column || columnDirty(column) || root !== library()) continue;
      updateColumn(column.key, {
        document,
        source: document.source,
        html,
        external: false,
      });
    }
  }
  createDesktopLifecycle({
    dirty: anyDirty,
    busy,
    modalOpen: () => pickerOpen() || commandPanelOpen() || publicationImportOpen(),
    editorFocused: () => document.activeElement === editor(),
    onChange: () => run(syncFromDisk),
    onCommand: executeCommand,
    onRestoreLibrary: (path) => run(() => openLibrary(path)),
    onError: (error) => setError(String(error)),
  });
  return {
    library,
    pinnedNotes,
    sidebarVisible,
    index,
    columns,
    activeKey,
    columnReveal,
    activateColumn,
    moveColumn,
    closeColumn,
    columnDirty,
    current,
    source,
    mode,
    editorZoom,
    viewZoom,
    html,
    error,
    lastDeleted,
    busy,
    external,
    commandPanelOpen,
    publicationImportOpen,
    setPublicationImportOpen,
    importPublication,
    focusActive,
    pickerOpen,
    pickerMode,
    dirty,
    commands,
    setSource,
    setCommandPanelOpen,
    setPickerOpen,
    executeCommand,
    selectNote,
    pickerCloseFocus,
    openLinked: (id: string, fromKey: number) => {
      void run(() => openLinked(id, fromKey));
    },
    setColumnSource: (key: number, source: string) =>
      updateColumn(key, { source }),
    openNote: (id: string) => {
      void run(() => load(id));
    },
    openIssue: (issue: Diagnostic) => {
      void run(() => openDiagnostic(issue));
    },
    dismissError: () => setError(""),
    reload: () => {
      if (
        current() &&
        window.confirm("Discard your draft and reload from disk?")
      )
        void run(() => load(current()!.note.id, true));
    },
    getNoteTitle: (id: string) => {
      const note = index().notes.find((note) => note.id === id);
      return note ? titleText(note) : undefined;
    },
    bindSidebar: (element: HTMLElement) => {
      sidebar = element;
    },
    bindMain: (element: HTMLElement) => {
      main = element;
    },
    bindEditor: (key: number, element: HTMLTextAreaElement) => {
      editors.set(key, element);
    },
    unbindEditor: (key: number) => {
      editors.delete(key);
    },
  };
}
export type LibrarySession = ReturnType<typeof createLibrarySession>;
