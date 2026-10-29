import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import ArrowUpRight from 'lucide-solid/icons/arrow-up-right';
import CircleAlert from 'lucide-solid/icons/circle-alert';
import FileText from 'lucide-solid/icons/file-text';
import FolderOpen from 'lucide-solid/icons/folder-open';
import Trash2 from 'lucide-solid/icons/trash-2';
import X from 'lucide-solid/icons/x';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import LibraryRoot from './LibraryRoot';
import NotePicker from './NotePicker';
import NoteTitle, { titleText } from './NoteTitle';
import NoteDate from './NoteDate';
import NoteView from './NoteView';
import NoteInfoPanel from './NoteInfoPanel';
import DiagnosticsPanel, { type Diagnostic } from './DiagnosticsPanel';

type Note = { id: string; title: string; title_text: string; title_html: string | null; tags: string[]; links: string[]; revision: string; diagnostic: string | null; diagnostics: Diagnostic[]; metadata: { type: string; document: string; date?: string } };
type Document = { note: Note; source: string };
type Index = { notes: Note[]; warnings: string[]; diagnostics: Diagnostic[] };
type DeletedNote = { id: string; trash_entry: string };

export default function App() {
  const [library, setLibrary] = createSignal('');
  const [sidebarVisible, setSidebarVisible] = createSignal(true);
  const [index, setIndex] = createSignal<Index>({ notes: [], warnings: [], diagnostics: [] });
  const [current, setCurrent] = createSignal<Document>();
  const [source, setSource] = createSignal('');
  const [mode, setMode] = createSignal<'edit' | 'view'>('view');
  const [html, setHtml] = createSignal('');
  const [error, setError] = createSignal('');
  const [lastDeleted, setLastDeleted] = createSignal<DeletedNote>();
  const [busy, setBusy] = createSignal(false);
  const [indexing, setIndexing] = createSignal(0);
  const [external, setExternal] = createSignal(false);
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pickerMode, setPickerMode] = createSignal<'open' | 'insert'>('open');
  const dirty = createMemo(() => !!current() && source() !== current()!.source);
  const backlinks = createMemo(() => index().notes.filter(n => n.links.includes(current()?.note.id ?? '')));
  let sidebar: HTMLElement | undefined;
  let main: HTMLElement | undefined;
  let editor: HTMLTextAreaElement | undefined;
  let pendingLink: { noteId: string; source: string; start: number; end: number } | undefined;
  let editPosition: { noteId: string; start: number; end: number; scrollTop: number } | undefined;
  let request = 0;
  let indexRequest = 0;
  let refreshTimer: ReturnType<typeof setTimeout>;
  async function run(action: () => Promise<void>) {
    if (busy()) return;
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  function toggleSidebar() {
    const hiding = sidebarVisible();
    const moveFocus = hiding && sidebar?.contains(document.activeElement);
    setSidebarVisible(!hiding);
    if (moveFocus) queueMicrotask(() => {
      if (mode() === 'edit' && editor?.isConnected) editor.focus();
      else main?.focus();
    });
  }
  async function refresh() {
    const token = ++indexRequest;
    const root = library();
    setIndexing(count => count + 1);
    try {
      const result = await invoke<Index>('list_notes');
      if (token === indexRequest && root === library()) setIndex(result);
    } finally { setIndexing(count => count - 1); }
  }
  async function openLibrary(path: string) {
    ++indexRequest;
    const root = await invoke<string>('open_library', { path });
    ++request; setLibrary(root); setLastDeleted(undefined); setCurrent(undefined); setSource(''); setHtml(''); setExternal(false);
    setIndex({ notes: [], warnings: [], diagnostics: [] });
    localStorage.setItem('dox.library', root);
    setIndex(await invoke<Index>('cached_notes'));
    // Let the tree and note commands work while fresh metadata is built.
    void refresh().catch(error => { if (library() === root) setError(String(error)); });
  }
  async function load(id: string, force = false) {
    if (!force && dirty() && !window.confirm('Discard the unsaved draft and open this note?')) return;
    const token = ++request;
    const doc = await invoke<Document>('read_note', { id });
    if (token !== request) return;
    setCurrent(doc); setSource(doc.source); setExternal(false); setHtml('');
    if (mode() === 'view') await preview(id, token);
  }
  async function preview(id: string, token = request) {
    if (current()?.note.id === id && current()?.note.diagnostic) { setHtml(''); return; }
    const rendered = await invoke<string>('render_note', { id });
    if (token === request) setHtml(rendered);
  }
  async function chooseLibrary() {
    if (dirty() && !window.confirm('Discard the unsaved draft and switch libraries?')) return;
    const path = await open({ directory: true, multiple: false, title: 'Open or create a dox library' });
    if (!path) return;
    await openLibrary(path);
  }
  async function save() {
    if (!current()) return;
    ++indexRequest;
    const doc = await invoke<Document>('save_note', { id: current()!.note.id, source: source(), revision: current()!.note.revision });
    setCurrent(doc); setSource(doc.source); setExternal(false);
    // Show save-time diagnostics immediately, even before the library refresh finishes.
    setIndex(previous => ({
      ...previous,
      notes: previous.notes.map(note => note.id === doc.note.id ? doc.note : note),
      diagnostics: [...previous.diagnostics.filter(issue => issue.note_id !== doc.note.id), ...doc.note.diagnostics],
    }));
    await refresh();
  }
  async function updateDate(id: string, date: string, revision: string): Promise<boolean> {
    let saved = false;
    await run(async () => {
      if (current()?.note.id !== id) return;
      ++indexRequest;
      const doc = await invoke<Document>('set_note_date', { id, date, revision });
      // Keep the editor's current draft; only its saved baseline and metadata change.
      setCurrent(doc);
      setExternal(false);
      await refresh();
      if (mode() === 'view') await preview(id);
      saved = true;
    });
    return saved;
  }
  async function deleteCurrent() {
    if (!current()) return;
    if (dirty()) await save();
    const id = current()!.note.id;
    const position = index().notes.findIndex(note => note.id === id);
    ++indexRequest;
    const deleted = await invoke<DeletedNote>('delete_note', { id, revision: current()!.note.revision });
    ++request; setCurrent(undefined); setSource(''); setHtml(''); setExternal(false); setPickerOpen(false);
    pendingLink = undefined; editPosition = undefined;
    setLastDeleted(deleted);
    await refresh();
    const next = index().notes[Math.min(position, index().notes.length - 1)];
    if (next) await load(next.id, true);
  }
  async function undoDelete() {
    const deleted = lastDeleted();
    if (!deleted) return;
    if (dirty()) await save();
    ++indexRequest;
    const doc = await invoke<Document>('restore_note', { trashEntry: deleted.trash_entry });
    ++request; setCurrent(doc); setSource(doc.source); setHtml(''); setExternal(false); setLastDeleted(undefined);
    await refresh();
    if (mode() === 'view') await preview(doc.note.id);
  }
  async function openDiagnostic(diagnostic: Diagnostic) {
    if (!diagnostic.note_id) return;
    if (current()?.note.id !== diagnostic.note_id) {
      const previousMode = mode();
      setMode('edit');
      await load(diagnostic.note_id);
      if (current()?.note.id !== diagnostic.note_id) { setMode(previousMode); return; }
    }
    edit();
    queueMicrotask(() => {
      if (!editor) return;
      let position = 0;
      const ownDocument = current()?.note.metadata.document;
      const notePath = `${current()?.note.id}/${ownDocument}`;
      const isOwnDocument = diagnostic.document === ownDocument || diagnostic.document === notePath || diagnostic.document?.endsWith(`/${notePath}`);
      if (diagnostic.line && isOwnDocument) {
        const lines = source().split('\n');
        const line = Math.max(0, Math.min(diagnostic.line - 1, lines.length - 1));
        position = lines.slice(0, line).reduce((length, text) => length + text.length + 1, 0) + Math.min((diagnostic.column ?? 1) - 1, lines[line].length);
      } else if (diagnostic.target_note_id) {
        position = Math.max(0, source().indexOf(`dox:${diagnostic.target_note_id}`));
      }
      editor.focus(); editor.setSelectionRange(position, position);
      const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 20;
      editor.scrollTop = Math.max(0, (source().slice(0, position).split('\n').length - 3) * lineHeight);
    });
  }
  async function view() {
    if (!current()) return;
    if (mode() === 'edit' && editor && current()) {
      editPosition = { noteId: current()!.note.id, start: editor.selectionStart, end: editor.selectionEnd, scrollTop: editor.scrollTop };
    }
    if (dirty()) await save();
    setHtml(''); setMode('view');
    await preview(current()!.note.id);
  }
  function edit() {
    if (!current()) return;
    setMode('edit');
    queueMicrotask(() => {
      editor?.focus();
      if (editor && editPosition && editPosition.noteId === current()?.note.id) {
        editor.setSelectionRange(editPosition.start, editPosition.end);
        editor.scrollTop = editPosition.scrollTop;
      }
    });
  }
  async function toggleMode() {
    if (!current()) return;
    if (mode() === 'edit') await view();
    else edit();
  }
  function openPicker() {
    if (!library()) return;
    pendingLink = undefined;
    setPickerMode('open');
    setPickerOpen(true);
  }
  function openLinkPicker() {
    if (busy() || !current() || mode() !== 'edit' || !editor || document.activeElement !== editor) return;
    pendingLink = { noteId: current()!.note.id, source: source(), start: editor.selectionStart, end: editor.selectionEnd };
    setPickerMode('insert');
    setPickerOpen(true);
  }
  function selectNote(id: string) {
    if (pickerMode() === 'open') { void run(() => load(id)); return; }
    const target = index().notes.find(note => note.id === id);
    if (!target || !pendingLink) return;
    const selection = pendingLink;
    if (mode() !== 'edit' || current()?.note.id !== selection.noteId || source() !== selection.source) {
      setError('The document changed while choosing a link. Insert the link again.');
      return;
    }
    const label = selection.source.slice(selection.start, selection.end) || target.title;
    const link = `#link("dox:${target.id}")[${label}]`;
    const updated = selection.source.slice(0, selection.start) + link + selection.source.slice(selection.end);
    const cursor = selection.start + link.length;
    setSource(updated);
    pendingLink = { ...selection, source: updated, start: cursor, end: cursor };
  }
  function pickerCloseFocus(event: Event) {
    if (pickerMode() !== 'insert') return;
    event.preventDefault();
    queueMicrotask(() => {
      const selection = pendingLink;
      if (editor && selection && mode() === 'edit' && selection.noteId === current()?.note.id && source() === selection.source) {
        editor.focus();
        editor.setSelectionRange(selection.start, selection.end);
      }
      pendingLink = undefined;
    });
  }
  async function create() {
    if (dirty()) await save();
    ++indexRequest;
    const doc = await invoke<Document>('create_note');
    ++request; setCurrent(doc); setSource(doc.source); setMode('edit'); setHtml(''); setExternal(false);
    setIndex(previous => ({ ...previous, notes: [doc.note, ...previous.notes] }));
    // The heading is ready to replace; typing starts without another click.
    queueMicrotask(() => {
      editor?.focus();
      editor?.setSelectionRange(2, 10);
    });
    await refresh();
  }
  onMount(() => {
    let stopped = false;
    let unlisten: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    getCurrentWindow().onCloseRequested(event => {
      if (dirty() && !window.confirm('Discard the unsaved draft and close dox?')) event.preventDefault();
    }).then(fn => { if (stopped) fn(); else unlistenClose = fn; }).catch(e => setError(String(e)));
    const changed = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (busy()) { changed(); return; }
        void run(async () => {
          await refresh();
          const active = current();
          if (!active) return;
          if (!index().notes.some(note => note.id === active.note.id) && !dirty()) {
            ++request; setCurrent(undefined); setSource(''); setHtml(''); setExternal(false); return;
          }
          const disk = await invoke<Document>('read_note', { id: active.note.id });
          if (dirty()) { setExternal(disk.note.revision !== active.note.revision); return; }
          await load(active.note.id, true);
        });
      }, 350);
    };
    listen('library-changed', changed).then(fn => { if (stopped) fn(); else unlisten = fn; }).catch(e => setError(String(e)));
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (event.altKey || event.shiftKey) return;
      if (key === 'p') {
        event.preventDefault();
        if (!pickerOpen()) openPicker();
        return;
      }
      if (key === 'b') {
        event.preventDefault();
        if (!pickerOpen()) toggleSidebar();
        return;
      }
      if (pickerOpen()) return;
      if (key === 'e' && current()) { event.preventDefault(); void run(toggleMode); }
      if (key === 'k' && mode() === 'edit' && document.activeElement === editor) { event.preventDefault(); openLinkPicker(); }
      if (key === 's') { event.preventDefault(); void run(save); }
      if (key === 'n' && library()) { event.preventDefault(); void run(create); }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', beforeUnload);
    const last = localStorage.getItem('dox.library');
    if (last) void run(() => openLibrary(last));
    onCleanup(() => { stopped = true; unlisten?.(); unlistenClose?.(); clearTimeout(refreshTimer); window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', beforeUnload); });
  });
  return <div class="app">
    <aside ref={sidebar} class="sidebar" hidden={!sidebarVisible()}>
      <header class="brand"><span class="mark">d</span><strong>dox</strong><span class="muted text-xs ml-auto">LOCAL NOTES</span><button class="open-library-action" aria-label="Open library" title="Open library" disabled={busy()} onClick={() => void run(chooseLibrary)}><FolderOpen size={15} strokeWidth={1.5} aria-hidden="true"/></button></header>
      <nav class="library-tree" aria-label="Libraries">
        <Show when={library()}>
          <LibraryRoot path={library()} noteCount={index().notes.length} busy={busy()} onCreate={() => void run(create)}>
      <nav class="note-list" aria-label="Notes"><For each={index().notes}>{note => <button classList={{ 'note-row': true, active: current()?.note.id === note.id }} disabled={busy()} onClick={() => void run(() => load(note.id))}><FileText class="note-icon" size={12} strokeWidth={1.5} aria-hidden="true"/><span class="note-title" title={titleText(note)}><NoteTitle note={note}/></span><Show when={note.diagnostics?.some(d => d.severity === 'error')}><span class="note-error-dot" aria-label="Has errors" title="Has errors"><CircleAlert size={10} strokeWidth={1.5} aria-hidden="true"/></span></Show><span class="note-id">{note.id}</span></button>}</For></nav>
          </LibraryRoot>
        </Show>
      </nav>
      <footer class="sidebar-footer"><span class="status-dot"/>{busy() ? 'Working…' : indexing() ? 'Indexing…' : library() ? 'On your filesystem' : 'No library open'}</footer>
    </aside>
    <main ref={main} tabIndex={-1}>
      <header class="toolbar"><div class="breadcrumb">notes <span>/</span> <span>{current()?.note.id ?? '—'}</span><Show when={dirty()}><span class="unsaved">● Unsaved</span></Show></div><Show when={current()}><div class="toolbar-actions"><Show when={mode() === 'view'}><NoteDate noteId={current()!.note.id} revision={current()!.note.revision} value={current()!.note.metadata.date} busy={busy()} onChange={updateDate}/></Show><button class="copy-note-link muted text-xs" onClick={() => void navigator.clipboard.writeText(`#link("dox:${current()!.note.id}")[${current()!.note.title}]`).catch(e => setError(String(e)))}>Copy link<ArrowUpRight size={12} strokeWidth={1.5} aria-hidden="true"/></button><button classList={{ selected: mode() === 'view' }} disabled={busy()} onClick={() => void run(view)} title="Toggle edit/view (⌘E)">View</button><button classList={{ selected: mode() === 'edit' }} disabled={busy()} onClick={edit} title="Toggle edit/view (⌘E)">Edit</button><button disabled={busy() || !dirty()} onClick={() => void run(save)}>Save <kbd>⌘S</kbd></button><button class="delete-note-action" aria-label="Delete note" title="Delete note" disabled={busy()} onClick={() => void run(deleteCurrent)}><Trash2 size={14} strokeWidth={1.5} aria-hidden="true"/></button></div></Show></header>
      <Show when={error()}><div class="notice error" role="alert"><pre>{error()}</pre><button aria-label="Dismiss error" onClick={() => setError('')}><X size={12} strokeWidth={1.5} aria-hidden="true"/></button></div></Show>
      <Show when={external()}><div class="notice">This note changed on disk. Your draft is preserved.<button onClick={() => { if (window.confirm('Discard your draft and reload from disk?')) void run(() => load(current()!.note.id, true)); }}>Reload from disk</button></div></Show>
      <Show when={current()} fallback={<div class="workspace"/>}>
        <div class="workspace"><Show when={mode() === 'edit'} fallback={<NoteView html={html()} onNavigate={id => void run(() => load(id))}/>}><textarea ref={editor} class="editor" aria-label="Typst source" spellcheck={false} value={source()} onInput={e => setSource(e.currentTarget.value)} /></Show></div>
        <Show when={backlinks().length}>
          <NoteInfoPanel title="BACKLINKS" count={backlinks().length} class="backlinks-panel">
            <div class="backlinks-list"><For each={backlinks()}>{note => <button disabled={busy()} onClick={() => void run(() => load(note.id))}><FileText class="note-icon" size={12} strokeWidth={1.5} aria-hidden="true"/><span class="backlink-title" title={titleText(note)}><NoteTitle note={note}/></span><span class="backlink-id">{note.id}</span></button>}</For></div>
          </NoteInfoPanel>
        </Show>
      </Show>
      <DiagnosticsPanel diagnostics={index().diagnostics} noteIds={index().notes.map(note => note.id)} busy={busy()} onOpen={diagnostic => void run(() => openDiagnostic(diagnostic))}/>
      <footer class="main-footer"><span>{mode() === 'edit' && current() ? current()!.note.metadata.document : 'Typst → HTML'}</span><Show when={lastDeleted()} fallback={<span>dox</span>}><span class="delete-undo">Deleted {lastDeleted()!.id}<button disabled={busy()} onClick={() => void run(undoDelete)}>Undo</button></span></Show></footer>
    </main>
    <NotePicker open={pickerOpen()} onOpenChange={setPickerOpen} notes={index().notes} busy={busy()} mode={pickerMode()} onSelect={selectNote} onCloseAutoFocus={pickerCloseFocus}/>

  </div>;
}
