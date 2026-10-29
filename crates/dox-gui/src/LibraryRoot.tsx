import { createSignal, createUniqueId, Show, type JSX } from 'solid-js';

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
        <span class="library-chevron" aria-hidden="true">{expanded() ? '▾' : '▸'}</span>
        <svg class="library-icon" aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 7V5a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"/>
        </svg>
        <span class="library-root-name">{name()}</span>
        <span class="library-root-count">{props.noteCount}</span>
      </button>
      <button class="library-root-create" aria-label={`Create note in ${name()}`} title="New note" disabled={props.busy} onClick={() => { setExpanded(true); props.onCreate(); }}>+</button>
    </div>
    <div id={childrenId} hidden={!expanded()}>
      <Show when={expanded()}><div class="library-root-children">{props.children}</div></Show>
    </div>
  </section>;
}
