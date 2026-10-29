import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { getCurrentWindow } from '@tauri-apps/api/window';
import LibraryRoot from './LibraryRoot';
import NotePicker from './NotePicker';

type Note = { id: string; title: string; tags: string[]; links: string[]; revision: string; diagnostic: string | null; metadata: { type: string; document: string } };
type Document = { note: Note; source: string };
type Index = { notes: Note[]; warnings: string[] };

export default function App() {
  const [library, setLibrary] = createSignal('');
  const [index, setIndex] = createSignal<Index>({ notes: [], warnings: [] });
  const [current, setCurrent] = createSignal<Document>();
  const [source, setSource] = createSignal('');
  const [mode, setMode] = createSignal<'edit' | 'view'>('view');
  const [html, setHtml] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [external, setExternal] = createSignal(false);
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const dirty = createMemo(() => !!current() && source() !== current()!.source);
  const backlinks = createMemo(() => index().notes.filter(n => n.links.includes(current()?.note.id ?? '')));
  let frame: HTMLIFrameElement | undefined;
  let editor: HTMLTextAreaElement | undefined;
  let request = 0;
  let refreshTimer: ReturnType<typeof setTimeout>;
  async function run(action: () => Promise<void>) {
    if (busy()) return;
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function refresh() { setIndex(await invoke<Index>('list_notes')); }
  async function load(id: string, force = false) {
    if (!force && dirty() && !window.confirm('Discard the unsaved draft and open this note?')) return;
    const token = ++request;
    const doc = await invoke<Document>('read_note', { id });
    if (token !== request) return;
    setCurrent(doc); setSource(doc.source); setExternal(false); setHtml('');
    if (mode() === 'view') await preview(id, token);
  }
  async function preview(id: string, token = request) {
    const rendered = await invoke<string>('render_note', { id });
    if (token === request) setHtml(rendered);
  }
  async function chooseLibrary() {
    if (dirty() && !window.confirm('Discard the unsaved draft and switch libraries?')) return;
    const path = await open({ directory: true, multiple: false, title: 'Open or create a dox library' });
    if (!path) return;
    const root = await invoke<string>('open_library', { path });
    ++request; setLibrary(root); setCurrent(undefined); setHtml(''); setExternal(false);
    localStorage.setItem('dox.library', root);
    await refresh();
  }
  async function save() {
    if (!current()) return;
    const doc = await invoke<Document>('save_note', { id: current()!.note.id, source: source(), revision: current()!.note.revision });
    setCurrent(doc); setSource(doc.source); setExternal(false);
    await refresh();
  }
  async function view() {
    if (!current()) return;
    if (dirty()) await save();
    setHtml(''); setMode('view');
    await preview(current()!.note.id);
  }
  async function create() {
    if (dirty()) await save();
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
  const renderedDocument = createMemo(() => {
    const css = `<style>html{color-scheme:dark}body{background:#1c1e22;color:#d9dce3;font:16px/1.75 -apple-system,BlinkMacSystemFont,sans-serif;max-width:780px;margin:0 auto;padding:40px 42px}h1,h2,h3{line-height:1.25;color:#f0f1f4}h1{font-size:30px;letter-spacing:-.6px}a{color:#a4c6ef}pre,code{font-family:ui-monospace,monospace}svg,img{max-width:100%;height:auto}blockquote{border-left:2px solid #5c6575;padding-left:20px;margin-left:0}</style>`;
    const origin = window.location.origin;
    const script = `<script src="${origin}/note-bridge.js"></script>`;
    const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${origin}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:;">`;
    return html().replace(/<head[^>]*>/i, match => match + policy + css) + script;
  });
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
          const disk = await invoke<Document>('read_note', { id: active.note.id });
          if (dirty()) { setExternal(disk.note.revision !== active.note.revision); return; }
          await load(active.note.id, true);
        });
      }, 350);
    };
    listen('library-changed', changed).then(fn => { if (stopped) fn(); else unlisten = fn; }).catch(e => setError(String(e)));
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame?.contentWindow) return;
      if (event.data?.type === 'dox-link' && /^[0-9A-Z]{5}$/.test(event.data.id)) void run(() => load(event.data.id));
      if (event.data?.type === 'dox-shortcut' && event.data.key === 'p' && library()) setPickerOpen(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'p' && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        if (library()) setPickerOpen(true);
        return;
      }
      if (pickerOpen()) return;
      if (key === 's') { event.preventDefault(); void run(save); }
      if (key === 'n' && library()) { event.preventDefault(); void run(create); }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', beforeUnload);
    const last = localStorage.getItem('dox.library');
    if (last) void run(async () => { setLibrary(await invoke<string>('open_library', { path: last })); await refresh(); });
    onCleanup(() => { stopped = true; unlisten?.(); unlistenClose?.(); clearTimeout(refreshTimer); window.removeEventListener('message', onMessage); window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', beforeUnload); });
  });
  return <div class="app">
    <aside class="sidebar">
      <header class="brand"><span class="mark">d</span><strong>dox</strong><span class="muted text-xs ml-auto">LOCAL NOTES</span><button class="open-library-action" aria-label="Open library" title="Open library" disabled={busy()} onClick={() => void run(chooseLibrary)}><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7V5a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v3M3 7v12a1 1 0 0 0 1 1h15l3-9H7l-3 9"/></svg></button></header>
      <nav class="library-tree" aria-label="Libraries">
        <Show when={library()}>
          <LibraryRoot path={library()} noteCount={index().notes.length} busy={busy()} onCreate={() => void run(create)}>
      <nav class="note-list" aria-label="Notes"><For each={index().notes}>{note => <button classList={{ 'note-row': true, active: current()?.note.id === note.id }} disabled={busy()} onClick={() => void run(() => load(note.id))}><span class="note-title" title={note.title}>{note.title}</span><span class="note-id">{note.id}</span></button>}</For></nav>
          </LibraryRoot>
        </Show>
      </nav>
      <footer class="sidebar-footer"><span class="status-dot"/>{busy() ? 'Working…' : library() ? 'On your filesystem' : 'No library open'}</footer>
    </aside>
    <main>
      <header class="toolbar"><div class="breadcrumb">notes <span>/</span> <span>{current()?.note.id ?? '—'}</span><Show when={dirty()}><span class="unsaved">● Unsaved</span></Show></div><Show when={current()}><div class="flex gap-1"><button class="muted text-xs" onClick={() => void navigator.clipboard.writeText(`#link("dox:${current()!.note.id}")[#text(${JSON.stringify(current()!.note.title)})]`).catch(e => setError(String(e)))}>Copy link ↗</button><button classList={{ selected: mode() === 'view' }} disabled={busy()} onClick={() => void run(view)}>View</button><button classList={{ selected: mode() === 'edit' }} disabled={busy()} onClick={() => setMode('edit')}>Edit</button><button disabled={busy() || !dirty()} onClick={() => void run(save)}>Save <kbd>⌘S</kbd></button></div></Show></header>
      <Show when={error()}><div class="notice error" role="alert"><pre>{error()}</pre><button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div></Show>
      <Show when={external()}><div class="notice">This note changed on disk. Your draft is preserved.<button onClick={() => { if (window.confirm('Discard your draft and reload from disk?')) void run(() => load(current()!.note.id, true)); }}>Reload from disk</button></div></Show>
      <Show when={index().warnings.length}><div class="notice error"><pre>{index().warnings.join('\n')}</pre></div></Show>
      <Show when={current()} fallback={<div class="workspace"/>}>
        <Show when={current()?.note.diagnostic && mode() === 'edit'}><details class="diagnostic"><summary>Typst diagnostics</summary><pre>{current()?.note.diagnostic}</pre></details></Show>
        <div class="workspace"><Show when={mode() === 'edit'} fallback={<Show when={html()} fallback={<div class="muted p-8">{busy() ? 'Compiling Typst…' : 'No rendered content.'}</div>}><iframe ref={frame} title="Rendered note" sandbox="allow-scripts" srcdoc={renderedDocument()} /></Show>}><textarea ref={editor} class="editor" aria-label="Typst source" spellcheck={false} value={source()} onInput={e => setSource(e.currentTarget.value)} /></Show></div>
        <section class="connections"><div><h2>BACKLINKS <span>{backlinks().length}</span></h2><Show when={backlinks().length}><For each={backlinks()}>{n => <button onClick={() => void run(() => load(n.id))}>{n.title} <span>↗ {n.id}</span></button>}</For></Show></div><div><h2>LINKS <span>{current()?.note.links.length}</span></h2><For each={current()?.note.links}>{id => <button onClick={() => void run(() => load(id))}>{index().notes.find(n => n.id === id)?.title ?? 'Missing note'} <span>↗ {id}</span></button>}</For></div></section>
      </Show>
      <footer class="main-footer"><span>{mode() === 'edit' && current() ? current()!.note.metadata.document : 'Typst → HTML'}</span><span>Local first · dox</span></footer>
    </main>
    <NotePicker open={pickerOpen()} onOpenChange={setPickerOpen} notes={index().notes} busy={busy()} onSelect={id => void run(() => load(id))}/>

  </div>;
}
