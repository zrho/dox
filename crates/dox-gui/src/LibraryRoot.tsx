import Button from './ui/components/Button';
import { createSignal, createUniqueId, Show, type JSX } from 'solid-js';
import Folder from 'lucide-solid/icons/folder';
import FolderOpen from 'lucide-solid/icons/folder-open';

type LibraryRootProps = {
  path: string;
  children: JSX.Element;
};

/** One independently collapsible root; future libraries can be siblings. */
export default function LibraryRoot(props: LibraryRootProps) {
  const [expanded, setExpanded] = createSignal(true);
  const childrenId = createUniqueId();
  const name = () => props.path.split('/').filter(Boolean).pop() || props.path;

  return <section class="library-root" aria-label={`Library: ${name()}`}>
    <div class="library-root-header">
      <Button
        class="library-root-toggle"
        aria-expanded={expanded()}
        aria-controls={childrenId}
        title={props.path}
        onClick={() => setExpanded(!expanded())}
      >
        <Show when={expanded()} fallback={<Folder class="library-icon" size={12} strokeWidth={1.5} aria-hidden="true"/>}>
          <FolderOpen class="library-icon" size={12} strokeWidth={1.5} aria-hidden="true"/>
        </Show>
        <span class="library-root-name">{name()}</span>
      </Button>
    </div>
    <div id={childrenId} hidden={!expanded()}>
      <div class="library-root-children">{props.children}</div>
    </div>
  </section>;
}
