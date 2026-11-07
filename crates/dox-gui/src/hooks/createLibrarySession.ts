import { batch, createMemo, createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { Channel, invoke } from "@tauri-apps/api/core";
import { confirm, open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import {
    commandDefinitions,
    type CommandId,
    type UICommand,
} from "../utils/commands";
import { titleText } from "../components/features/NoteTitle";
import { toggleTheme } from "../utils/theme";
import type { NoteEditorHandle } from "../components/features/NoteEditor";
import type {
    Note,
    Document,
    Index,
    DeletedNote,
    Diagnostic,
    NotePane,
    WorkspacePane,
    NotePickerMode,
    Attachment,
    PublicationImport,
} from "../types";
import { isNotePane } from "../types";
import { createGitSession } from "./createGitSession";
import { createDesktopLifecycle } from "./createDesktopLifecycle";
const defaultZoom = { editorZoom: 100, viewZoom: 90 };
export function createLibrarySession() {
    const [library, setLibrary] = createSignal("");
    // Reconcile by ID so refreshed JSON updates fields without replacing rows.
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
    const [workspace, setWorkspace] = createStore<{ panes: WorkspacePane[] }>({
        panes: [],
    });
    const [activeKey, setActiveKey] = createSignal<number>();
    const [paneReveal, setPaneReveal] = createSignal(0);
    let nextPaneKey = 0;
    const panes = () => workspace.panes;
    const activePane = () => panes().find((pane) => pane.key === activeKey());
    const notePanes = () => panes().filter(isNotePane);
    const activeNotePane = () => {
        const pane = activePane();
        return pane && isNotePane(pane) ? pane : undefined;
    };
    const current = () => activeNotePane()?.document;
    const source = () => activeNotePane()?.source ?? "";
    const mode = () => activeNotePane()?.mode ?? "view";
    const html = () => activeNotePane()?.html ?? "";
    const editorZoom = () =>
        activeNotePane()?.editorZoom ?? defaultZoom.editorZoom;
    const viewZoom = () => activeNotePane()?.viewZoom ?? defaultZoom.viewZoom;
    const external = () => activeNotePane()?.external ?? false;
    const editors = new Map<number, NoteEditorHandle>();
    const paneFrames = new Map<number, HTMLElement>();
    const editor = () => {
        const pane = activeNotePane();
        return pane ? editors.get(pane.key) : undefined;
    };
    function updateNotePane(
        key: number,
        patch: Partial<Omit<NotePane, "key" | "kind">>,
    ) {
        setWorkspace(
            "panes",
            (pane) => pane.key === key && isNotePane(pane),
            patch,
        );
    }
    function updateActiveNote(patch: Partial<Omit<NotePane, "key" | "kind">>) {
        const key = activeNotePane()?.key;
        if (key !== undefined) updateNotePane(key, patch);
    }
    const setCurrent = (document: Document) => updateActiveNote({ document });
    const setSource = (source: string) => updateActiveNote({ source });
    const setMode = (mode: "view" | "edit") => updateActiveNote({ mode });
    const setHtml = (html: string) => updateActiveNote({ html });
    const setExternal = (external: boolean) => updateActiveNote({ external });
    function addPane(pane: WorkspacePane, prefix = panes().length) {
        batch(() => {
            setWorkspace("panes", [...panes().slice(0, prefix), pane]);
            setActiveKey(pane.key);
        });
        queueMicrotask(focusActive);
        return pane.key;
    }
    function addNotePane(
        document: Document,
        html: string,
        mode: "view" | "edit" = "view",
        prefix = panes().length,
    ) {
        return addPane(
            {
                key: ++nextPaneKey,
                kind: "note",
                document,
                source: document.source,
                html,
                mode,
                external: false,
                editorZoom: editorZoom(),
                viewZoom: viewZoom(),
            },
            prefix,
        );
    }
    function showGitChanges() {
        const existing = panes().find((pane) => pane.kind === "git-changes");
        if (existing) revealPane(existing.key);
        else addPane({ key: ++nextPaneKey, kind: "git-changes" });
    }
    function focusActive() {
        const pane = activePane();
        const frame = pane && paneFrames.get(pane.key);
        if (activeNotePane()?.mode === "edit")
            editor()?.focus({ preventScroll: true });
        else if (!pane || isNotePane(pane))
            main?.focus({ preventScroll: true });
        else frame?.focus({ preventScroll: true });
    }
    function revealPane(key: number) {
        batch(() => {
            setActiveKey(key);
            setPaneReveal((request) => request + 1);
        });
        queueMicrotask(focusActive);
    }
    const notePaneDirty = (pane: NotePane) =>
        pane.source !== pane.document.source;
    const anyDirty = () => notePanes().some(notePaneDirty);
    async function confirmDiscard(removed: WorkspacePane[]) {
        const unsaved = removed.filter(isNotePane).filter(notePaneDirty);
        if (!unsaved.length) return true;
        return confirm(
            unsaved.length === 1
                ? `Discard unsaved changes to “${titleText(unsaved[0].document.note)}”?`
                : `Discard unsaved changes in ${unsaved.length} panes?`,
            {
                title: "Unsaved changes",
                kind: "warning",
                okLabel: "Discard changes",
                cancelLabel: "Keep editing",
            },
        );
    }
    function activatePane(key: number) {
        if (!busy() && panes().some((pane) => pane.key === key))
            setActiveKey(key);
    }
    function movePane(key: number, destination: number) {
        if (busy()) return;
        const reordered = [...panes()];
        const from = reordered.findIndex((pane) => pane.key === key);
        if (from < 0) return;
        const to = Math.max(0, Math.min(reordered.length - 1, destination));
        if (from === to) return;
        const [pane] = reordered.splice(from, 1);
        reordered.splice(to, 0, pane);
        setWorkspace("panes", reordered);
    }
    function removePane(key: number) {
        const position = panes().findIndex((pane) => pane.key === key);
        const remaining = panes().filter((pane) => pane.key !== key);
        batch(() => {
            setWorkspace("panes", remaining);
            if (activeKey() === key)
                setActiveKey(
                    remaining[Math.min(position, remaining.length - 1)]?.key,
                );
        });
    }
    function closePane(key: number) {
        void run(async () => {
            const pane = panes().find((pane) => pane.key === key);
            if (!pane || !(await confirmDiscard([pane]))) return;
            removePane(key);
            queueMicrotask(focusActive);
        });
    }
    function zoomContent(change: number | "reset") {
        const pane = activeNotePane();
        if (!pane) return;
        const field = pane.mode === "edit" ? "editorZoom" : "viewZoom";
        const value = pane[field];
        updateActiveNote({
            [field]:
                change === "reset"
                    ? defaultZoom[field]
                    : Math.max(50, Math.min(250, value + change)),
        });
    }
    const [error, setError] = createSignal("");
    const [warning, setWarning] = createSignal("");
    const [lastDeleted, setLastDeleted] = createSignal<DeletedNote>();
    const [localBusy, setBusy] = createSignal(false);
    const git = createGitSession({
        library,
        draftTitles: () => notePanes().filter(notePaneDirty).map((pane) => titleText(pane.document.note)),
        busy: localBusy,
    });
    const busy = () => localBusy() || git.frozen();
    const [exportStatus, setExportStatus] = createSignal("");
    const [commandPanelOpen, setCommandPanelOpen] = createSignal(false);
    const [pickerOpen, setPickerOpen] = createSignal(false);
    const [pickerMode, setPickerMode] = createSignal<NotePickerMode>("open");
    const [publicationImportOpen, setPublicationImportOpen] =
        createSignal(false);
    const dirty = createMemo(
        () => !!current() && source() !== current()!.source,
    );
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
    function closeFocused() {
        const key = activeKey();
        if (key !== undefined) closePane(key);
    }
    function dismissMessage() {
        if (error()) {
            setError("");
            return true;
        }
        if (warning()) {
            setWarning("");
            return true;
        }
        return false;
    }
    function escapeFocused() {
        if (dismissMessage() || busy()) return;
        if (current() && mode() === "edit") {
            void run(view);
        } else {
            closeFocused();
        }
    }
    function focusAdjacentPane(direction: -1 | 1) {
        const position = panes().findIndex((pane) => pane.key === activeKey());
        const next = position >= 0 ? panes()[position + direction] : undefined;
        if (next) revealPane(next.key);
    }
    function moveFocusedPane(direction: -1 | 1) {
        const position = panes().findIndex((pane) => pane.key === activeKey());
        if (position < 0) return;
        movePane(panes()[position].key, position + direction);
        queueMicrotask(focusActive);
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
        setWarning("");
        setLastDeleted(undefined);
        setWorkspace("panes", []);
        setActiveKey(undefined);
        editors.clear();
        paneFrames.clear();
        setIndex({ notes: [], warnings: [], diagnostics: [] });
        localStorage.setItem("dox.library", root);
        setIndex(await invoke<Index>("cached_notes"));
        // Let the tree and note commands work while fresh metadata is built.
        void refresh().catch((error) => {
            if (library() === root) setError(String(error));
        });
    }
    async function readNotePane(
        id: string,
        paneMode: "view" | "edit" = "view",
    ) {
        const document = await invoke<Document>("read_note", { id });
        const html =
            paneMode === "view" && !document.note.diagnostic
                ? await invoke<string>("render_note", { id })
                : "";
        return { document, html };
    }
    async function openItem(id: string) {
        const focused = activeNotePane();
        const existing =
            focused?.document.note.id === id
                ? focused
                : notePanes().find((pane) => pane.document.note.id === id);
        if (existing) {
            revealPane(existing.key);
            return;
        }
        const token = ++request;
        const result = await readNotePane(id);
        if (token === request) addNotePane(result.document, result.html);
    }
    async function load(id: string, force = false) {
        const existing = notePanes().find(
            (pane) => pane.document.note.id === id,
        );
        if (existing && !force) {
            revealPane(existing.key);
            return;
        }
        if (!force && !(await confirmDiscard(panes()))) return;
        const token = ++request;
        const result = await readNotePane(
            id,
            force && existing ? existing.mode : "view",
        );
        if (token !== request) return;
        if (force && existing) {
            updateNotePane(existing.key, {
                ...result,
                source: result.document.source,
                external: false,
            });
        } else addNotePane(result.document, result.html, "view", 0);
    }
    async function openLinked(id: string, fromKey: number) {
        if (!panes().some((pane) => pane.key === fromKey)) return;
        await openItem(id);
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
    async function saveNotePane(key: number) {
        const pane = notePanes().find((pane) => pane.key === key);
        if (!pane) return;
        const root = library();
        ++indexRequest;
        const doc = await invoke<Document>("save_note", {
            id: pane.document.note.id,
            source: pane.source,
            revision: pane.document.note.revision,
        });
        if (library() !== root) return;
        updateNotePane(key, { document: doc, source: doc.source, external: false });
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
    }
    async function save() {
        const pane = activeNotePane();
        if (!pane) return;
        await saveNotePane(pane.key);
        await refresh();
    }
    async function saveAllDrafts() {
        const keys = notePanes().filter(notePaneDirty).map((pane) => pane.key);
        for (const key of keys) await saveNotePane(key);
        await refresh();
        await git.refresh(true);
    }
    async function refreshAttachments(id: string) {
        const attachments = await invoke<Attachment[]>("list_attachments", {
            id,
        });
        for (const pane of notePanes().filter(
            (pane) => pane.document.note.id === id,
        )) {
            // Update attachments independently of the saved source and any editor draft.
            updateNotePane(pane.key, {
                document: { ...pane.document, attachments },
            });
        }
    }
    async function attachFiles(id: string, droppedPaths?: string[]) {
        const paths =
            droppedPaths ??
            (await open({ multiple: true, title: "Attach files" }));
        if (!paths?.length) return;
        try {
            await invoke<void>("attach_files", { id, paths });
        } finally {
            // Earlier files may already have been copied if a later one failed.
            await refreshAttachments(id);
        }
    }
    async function removeAttachment(id: string, name: string) {
        if (
            !(await confirm(
                `Remove “${name}” from this item? This deletes the attached copy in the library.`,
                {
                    title: "Remove attachment",
                    kind: "warning",
                    okLabel: "Remove attachment",
                    cancelLabel: "Cancel",
                },
            ))
        )
            return;
        await invoke<void>("remove_attachment", { id, name });
        await refreshAttachments(id);
    }
    async function findPaperPdf() {
        const pane = activeNotePane();
        if (!pane || pane.document.note.metadata.type !== "literature") return;
        const id = pane.document.note.id;
        await invoke<Attachment>("find_paper_pdf", { id, source: pane.source });
        await refreshAttachments(id);
        setWarning("");
    }
    async function deleteCurrent() {
        const document = current();
        if (!document) return;
        if (
            !(await confirm(`Delete “${titleText(document.note)}”?`, {
                title: "Delete note",
                kind: "warning",
                okLabel: "Delete",
                cancelLabel: "Cancel",
            }))
        )
            return;
        if (current() !== document) return;
        if (dirty()) await save();
        const id = current()!.note.id;
        ++indexRequest;
        const deleted = await invoke<DeletedNote>("delete_note", {
            id,
            revision: current()!.note.revision,
        });
        ++request;
        const pane = notePanes().find((pane) => pane.document.note.id === id);
        if (pane) removePane(pane.key);
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
        const existing = notePanes().find(
            (pane) => pane.document.note.id === doc.note.id,
        );
        if (existing) {
            updateNotePane(existing.key, {
                document: doc,
                source: doc.source,
                html: rendered,
            });
            setActiveKey(existing.key);
        } else addNotePane(doc, rendered, mode());
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
            const notePath = `notes/${current()?.note.id}/${ownDocument}`;
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
            editor()!.revealPosition(position);
        });
    }
    async function view() {
        if (!current()) return;
        if (mode() === "edit" && editor() && current()) {
            editPosition = {
                noteId: current()!.note.id,
                start: editor()!.selection.start,
                end: editor()!.selection.end,
                scrollTop: editor()!.scrollTop,
            };
        }
        if (dirty()) await save();
        // Keep the editor visible until the rendered result is ready.
        await preview(current()!.note.id);
        setMode("view");
        queueMicrotask(focusActive);
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
                editor()!.setSelection(editPosition.start, editPosition.end);
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
            !editor()?.hasFocus
        )
            return;
        pendingLink = {
            noteId: current()!.note.id,
            source: source(),
            start: editor()!.selection.start,
            end: editor()!.selection.end,
        };
        setPickerMode(withTitle ? "insert-with-title" : "insert");
        setPickerOpen(true);
    }
    function selectNote(id: string) {
        if (pickerMode() === "open") {
            void run(() => openItem(id));
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
            selection.source.slice(selection.start, selection.end) ||
            target.title;
        // Publication titles are bibliographic text, rather than Typst source.
        const publicationTitle = titleText(target)
            .replace(/\s+/g, " ")
            .trim()
            .replace(/[\\#@[\]{}$*_`<>~=+.\/-]/g, "\\$&");
        const citation =
            pickerMode() === "insert-with-title"
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
        editor()!.replaceRange(selection.start, selection.end, link);
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
                editor()!.focus({ preventScroll: true });
                editor()!.setSelection(selection.start, selection.end);
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
        addNotePane(doc, "", "edit");
        setIndex((previous) => ({
            ...previous,
            notes: [doc.note, ...previous.notes],
        }));
        // The heading is ready to replace; typing starts without another click.
        queueMicrotask(() => {
            editor()?.focus();
            const start = doc.source.indexOf("Untitled");
            editor()?.setSelection(start, start + 8);
        });
        await refresh();
    }
    async function openDailyNote() {
        ++indexRequest;
        const doc = await invoke<Document>("open_daily_note");
        const existing = notePanes().find(
            (pane) => pane.document.note.id === doc.note.id,
        );
        if (existing) {
            revealPane(existing.key);
        } else {
            ++request;
            addNotePane(doc, "", "edit");
            // Leave the date heading intact and start writing in the body.
            queueMicrotask(() => {
                editor()?.setSelection(doc.source.length, doc.source.length);
            });
        }
        setIndex((previous) => ({
            ...previous,
            notes: [
                doc.note,
                ...previous.notes.filter((note) => note.id !== doc.note.id),
            ],
        }));
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
        if (busy())
            throw new Error(
                "Another operation is in progress. Try again shortly.",
            );
        setBusy(true);
        setError("");
        setWarning("");
        try {
            const imported = await invoke<PublicationImport>(
                "import_publication",
                { input },
            );
            await showImportedPublication(imported);
        } finally {
            setBusy(false);
        }
    }
    async function importBibtex() {
        const path = await open({
            title: "Import literature from BibTeX file",
            multiple: false,
            directory: false,
            filters: [{ name: "BibTeX", extensions: ["bib"] }],
        });
        if (!path) return;
        setWarning("");
        const imported = await invoke<PublicationImport>("import_bibtex", {
            path,
        });
        await showImportedPublication(imported);
    }
    async function showImportedPublication(imported: PublicationImport) {
        const doc = imported.document;
        setWarning(imported.warnings.join("\n"));
        ++indexRequest;
        ++request;
        // Append the imported item without disturbing any open drafts.
        const key = addNotePane(doc, "", "edit");
        setIndex((previous) => ({
            ...previous,
            notes: [doc.note, ...previous.notes],
        }));
        // Creation has succeeded. A later render/refresh failure must not invite
        // another import of the same item; leave its source available instead.
        try {
            const html = await invoke<string>("render_note", {
                id: doc.note.id,
            });
            updateNotePane(key, { html, mode: "view" });
            await refresh();
        } catch (error) {
            setError(String(error));
        }
    }
    async function exportWebsite() {
        if (
            anyDirty() &&
            !(await confirm(
                "The website will include saved files only. Unsaved drafts will stay in the editor. Export saved content?",
                { title: "Export website", kind: "info" },
            ))
        )
            return;
        const destination = await saveDialog({
            title: "Export website directory",
            defaultPath: `${library()}-website`,
        });
        if (!destination) return;
        const exists = await invoke<boolean>("web_export_destination_exists", {
            destination,
        });
        if (
            exists &&
            !(await confirm(
                "Replace the website at this location? Only a previous dox website export can be replaced.",
                { title: "Replace website", kind: "warning" },
            ))
        )
            return;
        const progress = new Channel<{
            completed: number;
            total: number;
            message: string;
        }>();
        progress.onmessage = (update) =>
            setExportStatus(
                update.total
                    ? `${update.message} (${update.completed}/${update.total})`
                    : update.message,
            );
        setExportStatus("Exporting website…");
        try {
            const report = await invoke<{
                destination: string;
                notes: number;
                attachments: number;
                warnings: string[];
            }>("export_web", { destination, replace: exists, progress });
            setExportStatus(
                `Exported ${report.notes} items and ${report.attachments} attachments to ${report.destination}`,
            );
            if (report.warnings.length) setWarning(report.warnings.join("\n"));
        } catch (error) {
            setExportStatus("");
            throw error;
        }
    }
    const commandHandlers: Record<CommandId, () => void | Promise<void>> = {
        commands: () => {
            setCommandPanelOpen(true);
        },
        find: openPicker,
        close: closeFocused,
        escape: escapeFocused,
        "previous-pane": () => focusAdjacentPane(-1),
        "next-pane": () => focusAdjacentPane(1),
        "move-pane-previous": () => moveFocusedPane(-1),
        "move-pane-next": () => moveFocusedPane(1),
        "new-note": () => create(),
        "daily-note": openDailyNote,
        "new-window": () => {
            void invoke<void>("new_window").catch((error) =>
                setError(String(error)),
            );
        },
        "new-literature": () => create("literature"),
        "import-publication": () => {
            setPublicationImportOpen(true);
        },
        "import-bibtex": importBibtex,
        "open-library": chooseLibrary,
        "show-git-changes": showGitChanges,
        "git-check": () => git.act("fetch"),
        "git-commit": () => { showGitChanges(); return git.act("commit"); },
        "git-pull": () => git.act("pull"),
        "git-push": () => git.act("push"),
        "save-all-drafts": saveAllDrafts,
        "export-website": exportWebsite,
        "attach-files": async () => {
            const id = current()?.note.id;
            if (id) await attachFiles(id);
        },
        "find-paper-pdf": findPaperPdf,
        save,
        "toggle-theme": toggleTheme,
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
        if (id === "new-window" || id === "toggle-theme") return true;
        if (id === "escape" && (error() || warning())) return true;
        if (id === "zoom-in" || id === "zoom-out" || id === "zoom-reset")
            return !!current();
        if (busy()) return false;
        switch (id) {
            case "commands":
            case "open-library":
                return true;
            case "git-check":
                return !!library() && !!git.snapshot()?.status.available && !git.operation();
            case "git-commit": return git.canCommit();
            case "git-pull": return git.canPull();
            case "git-push": return git.canPush();
            case "save-all-drafts": return anyDirty();
            case "show-git-changes":
            case "find":
            case "new-note":
            case "daily-note":
            case "new-literature":
            case "import-publication":
            case "import-bibtex":
            case "export-website":
                return !!library();
            case "undo-delete":
                return !!lastDeleted();
            case "close":
            case "escape":
                return !!activePane();
            case "previous-pane":
            case "move-pane-previous":
                return (
                    panes().findIndex((pane) => pane.key === activeKey()) > 0
                );
            case "next-pane":
            case "move-pane-next": {
                const position = panes().findIndex(
                    (pane) => pane.key === activeKey(),
                );
                return position >= 0 && position < panes().length - 1;
            }
            case "insert":
            case "insert-with-title":
                return (
                    !!current() &&
                    current()!.note.metadata.type === "typst" &&
                    mode() === "edit"
                );
            case "save":
                return !!current() && dirty();
            case "find-paper-pdf":
                return current()?.note.metadata.type === "literature";
            default:
                return !!current();
        }
    }
    const commands = createMemo<UICommand[]>(() =>
        commandDefinitions.map((command) => ({
            ...command,
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
                "toggle-theme",
                "show-git-changes", "git-check", "git-commit", "git-pull", "git-push",
                "new-window",
                "import-publication",
                "find",
                "insert",
                "insert-with-title",
                "close",
                "escape",
                "previous-pane",
                "next-pane",
                "move-pane-previous",
                "move-pane-next",
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
        for (const snapshot of notePanes()) {
            if (root !== library()) return;
            if (
                !index().notes.some(
                    (note) => note.id === snapshot.document.note.id,
                )
            ) {
                if (notePaneDirty(snapshot))
                    updateNotePane(snapshot.key, { external: true });
                else removePane(snapshot.key);
                continue;
            }
            const document = await invoke<Document>("read_note", {
                id: snapshot.document.note.id,
            });
            let pane = notePanes().find((pane) => pane.key === snapshot.key);
            if (!pane) continue;
            if (notePaneDirty(pane)) {
                updateNotePane(pane.key, {
                    document: {
                        ...pane.document,
                        attachments: document.attachments,
                    },
                    external:
                        document.note.revision !== pane.document.note.revision,
                });
                continue;
            }
            const html =
                pane.mode === "view" && !document.note.diagnostic
                    ? await invoke<string>("render_note", {
                          id: document.note.id,
                      })
                    : pane.html;
            pane = notePanes().find((pane) => pane.key === snapshot.key);
            if (!pane || notePaneDirty(pane) || root !== library()) continue;
            updateNotePane(pane.key, {
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
        modalOpen: () =>
            pickerOpen() || commandPanelOpen() || publicationImportOpen(),
        editorFocused: () => editor()?.hasFocus ?? false,
        dismissMessage,
        onChange: async () => { void git.refresh(true); await run(syncFromDisk); },
        onCommand: executeCommand,
        onRestoreLibrary: (path) => run(() => openLibrary(path)),
        onError: (error) => setError(String(error)),
    });
    return {
        library,
        index,
        git,
        showGitChanges,
        saveAllDrafts: () => { void run(saveAllDrafts); },
        hasDrafts: anyDirty,
        openWorkspaceNote: (id: string) => { void run(() => openItem(id)); },
        panes,
        activeKey,
        paneReveal,
        activatePane,
        movePane,
        closePane,
        attachFiles: (id: string, paths?: string[]) => {
            void run(() => attachFiles(id, paths));
        },
        reportError: (error: unknown) => setError(String(error)),
        openAttachment: (id: string, name: string) => {
            void run(() => invoke<void>("open_attachment", { id, name }));
        },
        removeAttachment: (id: string, name: string) => {
            void run(() => removeAttachment(id, name));
        },
        notePaneDirty,
        current,
        source,
        mode,
        editorZoom,
        viewZoom,
        html,
        error,
        warning,
        lastDeleted,
        busy,
        exportStatus,
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
        setNoteSource: (key: number, source: string) => {
            if (!git.frozen()) updateNotePane(key, { source });
        },
        openNote: (id: string) => {
            void run(() => load(id));
        },
        openIssue: (issue: Diagnostic) => {
            void run(() => openDiagnostic(issue));
        },
        dismissError: () => setError(""),
        dismissWarning: () => setWarning(""),
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
        bindMain: (element: HTMLElement) => {
            main = element;
        },
        bindPaneFrame: (key: number, element: HTMLElement) => {
            paneFrames.set(key, element);
        },
        unbindPaneFrame: (key: number) => {
            paneFrames.delete(key);
        },
        bindEditor: (key: number, element: NoteEditorHandle) => {
            editors.set(key, element);
        },
        unbindEditor: (key: number) => {
            editors.delete(key);
        },
    };
}
export type LibrarySession = ReturnType<typeof createLibrarySession>;
