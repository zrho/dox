import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import CircleArrowUp from "lucide-solid/icons/circle-arrow-up";
import CircleCheck from "lucide-solid/icons/circle-check";
import Download from "lucide-solid/icons/download";
import LoaderCircle from "lucide-solid/icons/loader-circle";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import X from "lucide-solid/icons/x";
import RichTitle from "./RichTitle";
import NoteContent from "./NoteContent";
import { attachmentAvailable, createOffline, removeAttachment, saveAttachment } from "./offline";
import type { Attachment, Entry, Library, Note, Snapshot } from "./types";
import './style.css';

const root = new URL('./', location.href);
async function readJson<T>(url: string | URL): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not load library content (${response.status}). Reconnect and try again.`);
  return response.json();
}
function routeId() {
  const match = /^#\/note\/([^/]+)$/.exec(location.hash);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}
function matches(entry: Entry, query: string) {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const text = `${entry.title} ${entry.id} ${entry.tags.join(' ')}`.toLocaleLowerCase();
  return words.every(word => text.includes(word));
}
function AttachmentRow(props: { attachment: Attachment }) {
  const [saved, setSaved] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  createEffect(() => {
    const attachment = props.attachment;
    let stopped = false;
    attachmentAvailable(attachment).then(value => { if (!stopped) setSaved(value); }).catch(() => { if (!stopped) setSaved(false); });
    onCleanup(() => { stopped = true; });
  });
  async function toggle() {
    setBusy(true); setError('');
    try {
      if (saved()) { await removeAttachment(props.attachment); setSaved(false); }
      else { await saveAttachment(props.attachment); setSaved(true); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  const size = () => props.attachment.size < 1024 * 1024 ? `${Math.ceil(props.attachment.size / 1024)} KB` : `${(props.attachment.size / (1024 * 1024)).toFixed(1)} MB`;
  const actionLabel = () => `${busy() ? 'Downloading' : saved() ? 'Remove offline copy of' : 'Keep offline:'} ${props.attachment.name}`;
  return <li class="attachment">
    <a class="attachment-link" href={props.attachment.url} title={props.attachment.name} target="_blank" rel="noopener noreferrer">{props.attachment.name}</a>
    <span class="attachment-size muted">{size()}</span>
    <button class="icon-button" classList={{ saved: saved() }} disabled={busy()} onClick={() => void toggle()} aria-label={actionLabel()} title={actionLabel()} aria-pressed={saved()} aria-busy={busy()}>
      <Show when={!busy()} fallback={<LoaderCircle size={16} class="spin" aria-hidden="true" />}>
        <Show when={saved()} fallback={<Download size={16} aria-hidden="true" />}><CircleCheck size={16} aria-hidden="true" /></Show>
      </Show>
    </button>
    <Show when={error()}><p class="error" role="alert">{error()}</p></Show>
  </li>;
}
function App() {
  const [id, setId] = createSignal(routeId());
  const [query, setQuery] = createSignal('');
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [listScrolling, setListScrolling] = createSignal(false);
  let listScrollTimer: ReturnType<typeof setTimeout> | undefined;
  function revealListScrollbar() {
    setListScrolling(true);
    clearTimeout(listScrollTimer);
    listScrollTimer = setTimeout(() => setListScrolling(false), 900);
  }
  onCleanup(() => clearTimeout(listScrollTimer));
  const [reload, setReload] = createSignal(0);
  const [loadError, setLoadError] = createSignal('');
  async function load<T>(action: () => Promise<T>): Promise<T | undefined> {
    setLoadError('');
    try { return await action(); }
    catch (cause) { setLoadError(cause instanceof Error ? cause.message : String(cause)); return undefined; }
  }
  const [snapshot] = createResource(reload, () => load(async () => {
    const value = await readJson<Snapshot>(new URL('snapshot.json', root));
    if (value.schema_version !== 1) throw new Error('This export needs a newer reader. Export the library again.');
    return value;
  }));
  const [library] = createResource(snapshot, value => load(async () => {
    const result = await readJson<Library>(new URL(value.library_url, root));
    if (result.schema_version !== 1) throw new Error('Unsupported library format');
    return result;
  }));
  const noteUrl = createMemo(() => {
    const value = snapshot();
    const found = library()?.notes.find(note => note.id === id());
    return value && found ? new URL(`notes/${encodeURIComponent(found.id)}.json`, new URL(value.library_url, root)).href : undefined;
  });
  const [note, { refetch: refetchNote }] = createResource(noteUrl, url => load(() => readJson<Note>(url)));
  const filtered = createMemo(() => library()?.notes.filter(entry => matches(entry, query())) ?? []);
  const backlinks = createMemo(() => library()?.notes.filter(entry => entry.links.includes(id())) ?? []);
  const offline = createOffline(() => snapshot());
  const failed = loadError;
  function retry() { setReload(value => value + 1); if (id()) void refetchNote(); }
  let searchInput: HTMLInputElement | undefined;
  let content: HTMLElement | undefined;
  let started = false;
  const scrollPositions = new Map<string, number>();
  let departingId = id();
  let restoringHistory = false;
  const route = () => {
    if (content) scrollPositions.set(departingId, content.scrollTop);
    setId(routeId());
    departingId = routeId();
    setSidebarOpen(false);
  };
  const pop = () => { restoringHistory = true; };
  onMount(() => {
    history.scrollRestoration = 'manual';
    window.addEventListener('popstate', pop);
    window.addEventListener('hashchange', route);
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); showSearch(); }
      if (event.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', shortcut);
    onCleanup(() => {
      window.removeEventListener('popstate', pop);
      window.removeEventListener('hashchange', route);
      window.removeEventListener('keydown', shortcut);
    });
  });
  createEffect(() => {
    const value = library();
    if (value) {
      document.title = id() ? `${value.notes.find(entry => entry.id === id())?.title ?? 'Note'} · ${value.title}` : value.title;
      if (!started) { started = true; void offline.start(); }
    }
  });
  createEffect(() => {
    const current = note();
    const currentId = id();
    if (!current || current.id !== currentId) return;
    const top = restoringHistory ? scrollPositions.get(currentId) ?? 0 : 0;
    restoringHistory = false;
    requestAnimationFrame(() => {
      if (content) { content.scrollTop = top; content.focus({ preventScroll: true }); }
    });
  });
  function showSearch() {
    setSidebarOpen(true);
    requestAnimationFrame(() => searchInput?.focus());
  }
  function navigate(event: MouseEvent, nextId: string) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (nextId === id()) setSidebarOpen(false);
    restoringHistory = false;
  }
  return <div class="app">
    <header class="topbar">
      <Show when={id()}><button class="back icon-button" aria-label="Go back" title="Go back" onClick={() => history.length > 1 ? history.back() : location.assign('#/')}><ArrowLeft size={18} aria-hidden="true" /></button></Show>
      <input ref={searchInput} id="note-search" type="search" aria-label="Search notes" aria-controls="library-sidebar" placeholder="Search notes…" value={query()} onFocus={() => setSidebarOpen(true)} onInput={event => { setQuery(event.currentTarget.value); setSidebarOpen(true); }} />
      <Show when={id() && sidebarOpen()}><button class="close-sidebar icon-button" onClick={() => setSidebarOpen(false)} aria-label="Close note list"><X size={18} aria-hidden="true" /></button></Show>
    </header>
    <Show when={failed()}><div class="app-notice error" role="alert"><p>{failed()}</p><button onClick={retry}>Retry</button></div></Show>
    <div class="workspace">
      <Show when={sidebarOpen() && id()}><button class="scrim" aria-label="Close library" onClick={() => setSidebarOpen(false)} /></Show>
      <aside id="library-sidebar" class="sidebar" classList={{ open: sidebarOpen(), home: !id(), scrolling: listScrolling() }} onScroll={revealListScrollbar} aria-label="Library">
        <Show when={!library() && (snapshot.loading || library.loading)}><p role="status">Loading library…</p></Show>
        <nav aria-label="Notes"><ul class="note-list"><For each={filtered()}>{entry => <li>
          <a href={`#/note/${encodeURIComponent(entry.id)}`} title={entry.title} classList={{ selected: entry.id === id() }} aria-current={entry.id === id() ? 'page' : undefined} onClick={event => navigate(event, entry.id)}>
            <RichTitle note={entry} /><span class="entry-detail">{entry.id}</span>
          </a>
        </li>}</For></ul></nav>
        <Show when={library() && !filtered().length}><p class="muted">{query() ? 'No matching notes.' : 'This library is empty.'}</p></Show>
        <div class="offline-panel">
          <div class="offline-status">
            <p role="status" classList={{ error: offline.error() }}>{offline.status()}</p>
            <Show when={offline.waiting()} fallback={
              <button class="icon-button" disabled={offline.checking()} onClick={() => void offline.check()} aria-label={offline.error() ? 'Retry download' : 'Check for updates'} title={offline.error() ? 'Retry download' : 'Check for updates'} aria-busy={offline.checking()}><RefreshCw size={16} classList={{ spin: offline.checking() }} aria-hidden="true" /></button>
            }><button class="icon-button" onClick={offline.activate} aria-label="Open updated library" title="Open updated library"><CircleArrowUp size={16} aria-hidden="true" /></button></Show>
          </div>
          <Show when={snapshot()}>{value => <p class="muted snapshot-date">Exported {new Date(value().created_at).toLocaleString()}</p>}</Show>
        </div>
      </aside>
      <main ref={content} class="reader" classList={{ 'home-reader': !id() }} tabIndex={-1} aria-label="Reading area">
        <Show when={snapshot.loading || library.loading || (id() && note.loading)}><p class="message" role="status">Loading…</p></Show>
        <Show when={library() && !id()}><div class="welcome"><p>Choose a note to start reading.</p></div></Show>
        <Show when={library() && id() && !library()!.notes.some(entry => entry.id === id())}><div class="message"><h1>Note not found</h1><p>This note is not in this library snapshot.</p><a href="#/">Browse the library</a></div></Show>
        <Show when={!note.loading && note()?.id === id() && !note.error && note()} keyed>{current => <div class="document">
          <div class="note-metadata" aria-label="Note metadata"><Show when={current.date}><time dateTime={current.date!}>{current.date}</time></Show><span>{current.id}</span></div>
          <NoteContent note={current} />
          <Show when={current.tags.length}><ul class="tags" aria-label="Tags"><For each={current.tags}>{tag => <li><button onClick={() => { setQuery(tag); showSearch(); }}>{tag}</button></li>}</For></ul></Show>
          <Show when={backlinks().length}><section class="related"><h2>Linked from</h2><ul class="backlinks"><For each={backlinks()}>{entry => <li><a href={`#/note/${encodeURIComponent(entry.id)}`} onClick={event => navigate(event, entry.id)}><RichTitle note={entry} /></a></li>}</For></ul></section></Show>
          <Show when={current.attachments.length}><section class="related"><h2>Attachments</h2><ul class="attachments"><For each={current.attachments}>{attachment => <AttachmentRow attachment={attachment} />}</For></ul></section></Show>
        </div>}</Show>
      </main>
    </div>
  </div>;
}
render(() => <App />, document.getElementById('root')!);
