import Button from './Button';
import { createSignal, createUniqueId, Show, type JSX } from 'solid-js';
import ChevronRight from 'lucide-solid/icons/chevron-right';

type InfoPanelProps = {
  title: string;
  count?: number;
  class?: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  actions?: JSX.Element;
  children: JSX.Element;
};

/** Shared compact heading, disclosure, and scroll area for note information. */
export default function InfoPanel(props: InfoPanelProps) {
  const [localExpanded, setLocalExpanded] = createSignal(true);
  const contentId = createUniqueId();
  const expanded = () => props.expanded ?? localExpanded();
  function toggle() {
    const next = !expanded();
    setLocalExpanded(next);
    props.onExpandedChange?.(next);
  }
  return <section class={`note-info-panel ${props.class ?? ''}`} aria-label={props.title}>
    <header class="note-info-header">
      <h2 class="note-info-heading">
        <Button class="note-info-toggle" aria-expanded={expanded()} aria-controls={contentId} onClick={toggle}>
          <ChevronRight class="note-info-chevron" classList={{ 'is-expanded': expanded() }} size={10} strokeWidth={1.5} aria-hidden="true"/>
          {props.title}
          <Show when={props.count !== undefined}><span class="note-info-count">{props.count}</span></Show>
        </Button>
      </h2>
      {props.actions}
    </header>
    <div id={contentId} class="note-info-body" hidden={!expanded()}>{props.children}</div>
  </section>;
}
