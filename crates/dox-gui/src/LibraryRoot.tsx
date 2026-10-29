import { createSignal, createUniqueId, Show, type JSX } from 'solid-js';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import Folder from 'lucide-solid/icons/folder';
import FolderOpen from 'lucide-solid/icons/folder-open';
import Plus from 'lucide-solid/icons/plus';

type LibraryRootProps = {
  path: string;
  noteCount: number;
  busy: boolean;
  onCreate: () => void;
  children: JSX.Element;
};

/** One independently collapsible root; future libraries can be siblings. */
export default function LibraryRoot(props: LibraryRootProps) {
  const [expanded, setExpanded] = createSignal(true);
  const childrenId = createUniqueId();
  const name = () => props.path.split('/').filter(Boolean).pop() || props.path;

  return <section class="library-root" aria-label={`Library: ${name()}`}>
    <div class="library-root-header">
      <button
        class="library-root-toggle"
        aria-expanded={expanded()}
        aria-controls={childrenId}
        title={props.path}
        onClick={() => setExpanded(!expanded())}
      >
        <ChevronRight class="library-chevron" classList={{ 'is-expanded': expanded() }} size={10} strokeWidth={1.5} aria-hidden="true"/>
        <Show when={expanded()} fallback={<Folder class="library-icon" size={12} strokeWidth={1.5} aria-hidden="true"/>}>
          <FolderOpen class="library-icon" size={12} strokeWidth={1.5} aria-hidden="true"/>
        </Show>
        <span class="library-root-name">{name()}</span>
        <span class="library-root-count">{props.noteCount}</span>
      </button>
      <button class="library-root-create" aria-label={`Create note in ${name()}`} title="New note" disabled={props.busy} onClick={() => { setExpanded(true); props.onCreate(); }}><Plus size={12} strokeWidth={1.5} aria-hidden="true"/></button>
    </div>
    <div id={childrenId} hidden={!expanded()}>
      <Show when={expanded()}><div class="library-root-children">{props.children}</div></Show>
    </div>
  </section>;
}
