import Pencil from "lucide-solid/icons/pencil";
import Eye from "lucide-solid/icons/eye";
import Button from "./ui/components/Button";
import { createStore, reconcile } from "solid-js/store";
import {
    batch,
    createMemo,
    createSignal,
    For,
    onCleanup,
    onMount,
    Show,
} from "solid-js";
import Save from "lucide-solid/icons/save";
import IconButton from "./ui/components/IconButton";
import CircleAlert from "lucide-solid/icons/circle-alert";
import BookOpen from "lucide-solid/icons/book-open";
import FileText from "lucide-solid/icons/file-text";
import Trash2 from "lucide-solid/icons/trash";
import X from "lucide-solid/icons/x";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import CommandPanel from "./CommandPanel";
import {
    commandDefinitions,
    commandBinding,
    matchesBinding,
    type CommandId,
    type UICommand,
} from "./commands";
import LibraryRoot from "./LibraryRoot";
import NotePicker from "./NotePicker";
import NoteTitle, { titleText } from "./NoteTitle";
import NoteView from "./NoteView";
import NoteInfoPanel from "./ui/components/InfoPanel";
import DiagnosticsPanel, { type Diagnostic } from "./DiagnosticsPanel";

type Note = {
    id: string;
    title: string;
    title_text: string;
    title_html: string | null;
    tags: string[];
    links: string[];
    revision: string;
    diagnostic: string | null;
    diagnostics: Diagnostic[];
    metadata: { type: string; document: string; date?: string };
};
type Document = { note: Note; source: string };
type Index = { notes: Note[]; warnings: string[]; diagnostics: Diagnostic[] };
type DeletedNote = { id: string; trash_entry: string };

export default function App() {
    const [library, setLibrary] = createSignal("");
    const [sidebarVisible, setSidebarVisible] = createSignal(true);
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
    const [current, setCurrent] = createSignal<Document>();
    const [source, setSource] = createSignal("");
    const [mode, setMode] = createSignal<"edit" | "view">("view");
    const [html, setHtml] = createSignal("");
    const [error, setError] = createSignal("");
    const [lastDeleted, setLastDeleted] = createSignal<DeletedNote>();
    const [busy, setBusy] = createSignal(false);
    const [external, setExternal] = createSignal(false);
    const [commandPanelOpen, setCommandPanelOpen] = createSignal(false);
    const [pickerOpen, setPickerOpen] = createSignal(false);
    const [pickerMode, setPickerMode] = createSignal<"open" | "insert">("open");
    const dirty = createMemo(
        () => !!current() && source() !== current()!.source,
    );
    const backlinks = createMemo(() =>
        index().notes.filter((n) => n.links.includes(current()?.note.id ?? "")),
    );
    let sidebar: HTMLElement | undefined;
    let main: HTMLElement | undefined;
    let editor: HTMLTextAreaElement | undefined;
    let pendingLink:
        | { noteId: string; source: string; start: number; end: number }
        | undefined;
    let editPosition:
        | { noteId: string; start: number; end: number; scrollTop: number }
        | undefined;
    let request = 0;
    let indexRequest = 0;
    let refreshTimer: ReturnType<typeof setTimeout>;
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
                if (mode() === "edit" && editor?.isConnected) editor.focus();
                else main?.focus();
            });
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
        setCurrent(undefined);
        setSource("");
        setHtml("");
        setExternal(false);
        setIndex({ notes: [], warnings: [], diagnostics: [] });
        localStorage.setItem("dox.library", root);
        setIndex(await invoke<Index>("cached_notes"));
        // Let the tree and note commands work while fresh metadata is built.
        void refresh().catch((error) => {
            if (library() === root) setError(String(error));
        });
    }
    async function load(id: string, force = false) {
        if (
            !force &&
            dirty() &&
            !window.confirm("Discard the unsaved draft and open this note?")
        )
            return;
        const token = ++request;
        const doc = await invoke<Document>("read_note", { id });
        if (token !== request) return;
        // Prepare the next view before replacing the current document.
        const rendered =
            mode() === "view" && !doc.note.diagnostic
                ? await invoke<string>("render_note", { id })
                : "";
        if (token !== request) return;
        batch(() => {
            setCurrent(doc);
            setSource(doc.source);
            setExternal(false);
            setHtml(rendered);
        });
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
            dirty() &&
            !window.confirm("Discard the unsaved draft and switch libraries?")
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
    async function deleteCurrent() {
        if (!current()) return;
        if (dirty()) await save();
        const id = current()!.note.id;
        const position = index().notes.findIndex((note) => note.id === id);
        ++indexRequest;
        const deleted = await invoke<DeletedNote>("delete_note", {
            id,
            revision: current()!.note.revision,
        });
        ++request;
        setCurrent(undefined);
        setSource("");
        setHtml("");
        setExternal(false);
        setPickerOpen(false);
        pendingLink = undefined;
        editPosition = undefined;
        setLastDeleted(deleted);
        await refresh();
        const next =
            index().notes[Math.min(position, index().notes.length - 1)];
        if (next) await load(next.id, true);
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
        batch(() => {
            setCurrent(doc);
            setSource(doc.source);
            setHtml(rendered);
            setExternal(false);
            setLastDeleted(undefined);
        });
        await refresh();
    }
    async function openDiagnostic(diagnostic: Diagnostic) {
        if (!diagnostic.note_id) return;
        if (current()?.note.id !== diagnostic.note_id) {
            const previousMode = mode();
            setMode("edit");
            await load(diagnostic.note_id);
            if (current()?.note.id !== diagnostic.note_id) {
                setMode(previousMode);
                return;
            }
        }
        edit();
        queueMicrotask(() => {
            if (!editor) return;
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
            editor.focus();
            editor.setSelectionRange(position, position);
            const lineHeight =
                parseFloat(getComputedStyle(editor).lineHeight) || 20;
            editor.scrollTop = Math.max(
                0,
                (source().slice(0, position).split("\n").length - 3) *
                    lineHeight,
            );
        });
    }
    async function view() {
        if (!current()) return;
        if (mode() === "edit" && editor && current()) {
            editPosition = {
                noteId: current()!.note.id,
                start: editor.selectionStart,
                end: editor.selectionEnd,
                scrollTop: editor.scrollTop,
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
            editor?.focus();
            if (
                editor &&
                editPosition &&
                editPosition.noteId === current()?.note.id
            ) {
                editor.setSelectionRange(editPosition.start, editPosition.end);
                editor.scrollTop = editPosition.scrollTop;
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
    function openLinkPicker() {
        if (current()?.note.metadata.type !== "typst") return;
        if (
            busy() ||
            !current() ||
            mode() !== "edit" ||
            !editor ||
            document.activeElement !== editor
        )
            return;
        pendingLink = {
            noteId: current()!.note.id,
            source: source(),
            start: editor.selectionStart,
            end: editor.selectionEnd,
        };
        setPickerMode("insert");
        setPickerOpen(true);
    }
    function selectNote(id: string) {
        if (pickerMode() === "open") {
            void run(() => load(id));
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
        const link =
            target.metadata.type === "literature"
                ? `@${target.id}`
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
        if (pickerMode() !== "insert") return;
        event.preventDefault();
        queueMicrotask(() => {
            const selection = pendingLink;
            if (
                editor &&
                selection &&
                mode() === "edit" &&
                selection.noteId === current()?.note.id &&
                source() === selection.source
            ) {
                editor.focus();
                editor.setSelectionRange(selection.start, selection.end);
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
        setCurrent(doc);
        setSource(doc.source);
        setMode("edit");
        setHtml("");
        setExternal(false);
        setIndex((previous) => ({
            ...previous,
            notes: [doc.note, ...previous.notes],
        }));
        // The heading is ready to replace; typing starts without another click.
        queueMicrotask(() => {
            editor?.focus();
            const start = doc.source.indexOf("Untitled");
            editor?.setSelectionRange(start, start + 8);
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
    const commandHandlers: Record<CommandId, () => void | Promise<void>> = {
        commands: () => {
            setCommandPanelOpen(true);
        },
        find: openPicker,
        "new-note": () => create(),
        "new-literature": () => create("literature"),
        "open-library": chooseLibrary,
        save,
        "toggle-mode": toggleMode,
        edit,
        view,
        insert: () => {
            editor?.focus();
            openLinkPicker();
        },
        copy: copyReference,
        "toggle-sidebar": toggleSidebar,
        delete: deleteCurrent,
        "undo-delete": undoDelete,
    };
    function commandEnabled(id: CommandId) {
        if (busy()) return false;
        switch (id) {
            case "commands":
            case "open-library":
            case "toggle-sidebar":
                return true;
            case "find":
            case "new-note":
            case "new-literature":
                return !!library();
            case "undo-delete":
                return !!lastDeleted();
            case "insert":
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
            ["commands", "find", "insert", "toggle-sidebar", "edit"].includes(
                id,
            )
        ) {
            commandHandlers[id]();
        } else {
            void run(async () => {
                await commandHandlers[id]();
            });
        }
    }
    onMount(() => {
        let stopped = false;
        let unlisten: (() => void) | undefined;
        let unlistenClose: (() => void) | undefined;
        getCurrentWindow()
            .onCloseRequested((event) => {
                if (
                    dirty() &&
                    !window.confirm("Discard the unsaved draft and close dox?")
                )
                    event.preventDefault();
            })
            .then((fn) => {
                if (stopped) fn();
                else unlistenClose = fn;
            })
            .catch((e) => setError(String(e)));
        const changed = () => {
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                if (busy()) {
                    changed();
                    return;
                }
                void run(async () => {
                    await refresh();
                    const active = current();
                    if (!active) return;
                    if (
                        !index().notes.some(
                            (note) => note.id === active.note.id,
                        ) &&
                        !dirty()
                    ) {
                        ++request;
                        setCurrent(undefined);
                        setSource("");
                        setHtml("");
                        setExternal(false);
                        return;
                    }
                    const disk = await invoke<Document>("read_note", {
                        id: active.note.id,
                    });
                    if (dirty()) {
                        setExternal(
                            disk.note.revision !== active.note.revision,
                        );
                        return;
                    }
                    if (disk.note.revision !== active.note.revision) {
                        await load(active.note.id, true);
                    } else if (mode() === "view") {
                        // Imported files may change rendered output without changing this revision.
                        await preview(active.note.id);
                    }
                });
            }, 350);
        };
        listen("library-changed", changed)
            .then((fn) => {
                if (stopped) fn();
                else unlisten = fn;
            })
            .catch((e) => setError(String(e)));
        const onKey = (event: KeyboardEvent) => {
            const definition = commandDefinitions.find((command) =>
                matchesBinding(
                    event,
                    "binding" in command ? command.binding : undefined,
                ),
            );
            if (!definition) return;
            event.preventDefault();
            if (pickerOpen() || commandPanelOpen()) return;
            if (definition.id === "insert" && document.activeElement !== editor)
                return;
            executeCommand(definition.id);
        };
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (dirty()) {
                event.preventDefault();
                event.returnValue = "";
            }
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("beforeunload", beforeUnload);
        const last = localStorage.getItem("dox.library");
        if (last) void run(() => openLibrary(last));
        onCleanup(() => {
            stopped = true;
            unlisten?.();
            unlistenClose?.();
            clearTimeout(refreshTimer);
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("beforeunload", beforeUnload);
        });
    });
    return (
        <div class="app">
            <aside ref={sidebar} class="sidebar" hidden={!sidebarVisible()}>
                <nav class="library-tree" aria-label="Libraries">
                    <Show when={library()}>
                        <LibraryRoot path={library()}>
                            <nav class="note-list" aria-label="Notes">
                                <For each={index().notes}>
                                    {(note) => (
                                        <Button
                                            classList={{
                                                "note-row": true,
                                                active:
                                                    current()?.note.id ===
                                                    note.id,
                                            }}
                                            busy={busy()}
                                            onClick={() =>
                                                void run(() => load(note.id))
                                            }
                                        >
                                            <Show
                                                when={
                                                    note.metadata.type ===
                                                    "literature"
                                                }
                                                fallback={
                                                    <FileText
                                                        class="note-icon"
                                                        size={12}
                                                        strokeWidth={1.5}
                                                        aria-hidden="true"
                                                    />
                                                }
                                            >
                                                <BookOpen
                                                    class="note-icon"
                                                    size={12}
                                                    strokeWidth={1.5}
                                                    aria-hidden="true"
                                                />
                                            </Show>
                                            <span
                                                class="note-title"
                                                title={titleText(note)}
                                            >
                                                <NoteTitle note={note} />
                                            </span>
                                            <Show
                                                when={note.diagnostics?.some(
                                                    (d) =>
                                                        d.severity === "error",
                                                )}
                                            >
                                                <span
                                                    class="note-error-dot"
                                                    aria-label="Has errors"
                                                    title="Has errors"
                                                >
                                                    <CircleAlert
                                                        size={10}
                                                        strokeWidth={1.5}
                                                        aria-hidden="true"
                                                    />
                                                </span>
                                            </Show>
                                            <span class="note-id">
                                                {note.id}
                                            </span>
                                        </Button>
                                    )}
                                </For>
                            </nav>
                        </LibraryRoot>
                    </Show>
                </nav>

            </aside>
            <main ref={main} tabIndex={-1}>
                <header class="toolbar">
                    <div class="breadcrumb">
                        notes <span>/</span>{" "}
                        <span>{current()?.note.id ?? "—"}</span>
                        <Show when={dirty()}>
                            <span class="unsaved">● Unsaved</span>
                        </Show>
                    </div>
                    <Show when={current()}>
                        <div class="toolbar-actions">
                            <Show
                                when={
                                    mode() === "view" &&
                                    current()!.note.metadata.date
                                }
                            >
                                <time
                                    class="note-date"
                                    dateTime={current()!.note.metadata.date}
                                >
                                    {current()!.note.metadata.date}
                                </time>
                            </Show>
                            <IconButton
                                busy={busy()}
                                label={mode() === "view" ? "Edit source" : "View note"}
                                tooltip={`${mode() === "view" ? "Edit source" : "View note"} (${commandBinding("toggle-mode")})`}
                                onClick={() => executeCommand("toggle-mode")}
                            >
                                <Show when={mode() === "view"} fallback={<Eye size={14} strokeWidth={1.5} aria-hidden="true"/>}>
                                    <Pencil size={14} strokeWidth={1.5} aria-hidden="true"/>
                                </Show>
                            </IconButton>
                            <IconButton
                                label="Save note"
                                tooltip={`Save note (${commandBinding("save")})`}
                                disabled={!dirty()}
                                busy={busy()}
                                onClick={() => executeCommand("save")}
                            >
                                <Save size={14} strokeWidth={1.5} aria-hidden="true"/>
                            </IconButton>
                            <IconButton
                                variant="danger"
                                class="delete-note-action"
                                label="Delete note"
                                busy={busy()}
                                onClick={() => executeCommand("delete")}
                            >
                                <Trash2
                                    size={14}
                                    strokeWidth={1.5}
                                    aria-hidden="true"
                                />
                            </IconButton>
                        </div>
                    </Show>
                </header>
                <Show when={error()}>
                    <div class="notice error" role="alert">
                        <pre>{error()}</pre>
                        <IconButton
                            label="Dismiss error"
                            onClick={() => setError("")}
                        >
                            <X size={12} strokeWidth={1.5} aria-hidden="true" />
                        </IconButton>
                    </div>
                </Show>
                <Show when={external()}>
                    <div class="notice">
                        This note changed on disk. Your draft is preserved.
                        <Button
                            onClick={() => {
                                if (
                                    window.confirm(
                                        "Discard your draft and reload from disk?",
                                    )
                                )
                                    void run(() =>
                                        load(current()!.note.id, true),
                                    );
                            }}
                        >
                            Reload from disk
                        </Button>
                    </div>
                </Show>
                <Show when={current()} fallback={<div class="workspace" />}>
                    <div class="workspace">
                        <div class="workspace-pane" hidden={mode() !== "view"}>
                            <NoteView
                                html={html()}
                                active={mode() === "view"}
                                getNoteTitle={(id) => {
                                    const note = index().notes.find(
                                        (note) => note.id === id,
                                    );
                                    return note ? titleText(note) : undefined;
                                }}
                                onNavigate={(id) => void run(() => load(id))}
                            />
                        </div>
                        <div class="workspace-pane" hidden={mode() !== "edit"}>
                            <textarea
                                ref={editor}
                                class="editor"
                                aria-label={
                                    current()?.note.metadata.type ===
                                    "literature"
                                        ? "BibTeX source"
                                        : "Typst source"
                                }
                                spellcheck={false}
                                value={source()}
                                onInput={(e) =>
                                    setSource(e.currentTarget.value)
                                }
                            />
                        </div>
                    </div>
                    <Show when={backlinks().length}>
                        <NoteInfoPanel
                            title="BACKLINKS"
                            count={backlinks().length}
                            class="backlinks-panel"
                        >
                            <div class="backlinks-list">
                                <For each={backlinks()}>
                                    {(note) => (
                                        <Button
                                            busy={busy()}
                                            onClick={() =>
                                                void run(() => load(note.id))
                                            }
                                        >
                                            <FileText
                                                class="note-icon"
                                                size={12}
                                                strokeWidth={1.5}
                                                aria-hidden="true"
                                            />
                                            <span
                                                class="backlink-title"
                                                title={titleText(note)}
                                            >
                                                <NoteTitle note={note} />
                                            </span>
                                            <span class="backlink-id">
                                                {note.id}
                                            </span>
                                        </Button>
                                    )}
                                </For>
                            </div>
                        </NoteInfoPanel>
                    </Show>
                </Show>
                <DiagnosticsPanel
                    diagnostics={index().diagnostics}
                    noteIds={index().notes.map((note) => note.id)}
                    busy={busy()}
                    onOpen={(diagnostic) =>
                        void run(() => openDiagnostic(diagnostic))
                    }
                />
                <footer class="main-footer">
                    <span>
                        {mode() === "edit" && current()
                            ? current()!.note.metadata.document
                            : ""}
                    </span>
                    <Show when={lastDeleted()} fallback={<span>dox</span>}>
                        <span class="delete-undo">
                            Deleted {lastDeleted()!.id}
                            <Button
                                busy={busy()}
                                onClick={() => executeCommand("undo-delete")}
                            >
                                Undo
                            </Button>
                        </span>
                    </Show>
                </footer>
            </main>
            <CommandPanel
                open={commandPanelOpen()}
                onOpenChange={setCommandPanelOpen}
                commands={commands()}
                onSelect={executeCommand}
            />
            <NotePicker
                open={pickerOpen()}
                onOpenChange={setPickerOpen}
                notes={index().notes}
                busy={busy()}
                mode={pickerMode()}
                onSelect={selectNote}
                onCloseAutoFocus={pickerCloseFocus}
            />
        </div>
    );
}
