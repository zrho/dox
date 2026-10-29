import Button from './ui/components/Button';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import NoteInfoPanel from './ui/components/InfoPanel';

export type Severity = 'error' | 'warning' | 'proposal';
export type Diagnostic = {
  id: string;
  severity: Severity;
  code: string;
  message: string;
  note_id: string | null;
  document: string | null;
  line: number | null;
  column: number | null;
  target_note_id: string | null;
  actions: { kind: string; title: string; payload: unknown }[];
};

export default function DiagnosticsPanel(props: {
  diagnostics: Diagnostic[];
  noteIds: string[];
  busy: boolean;
  onOpen: (diagnostic: Diagnostic) => void;
}) {
  const [expanded, setExpanded] = createSignal(true);
  const [filter, setFilter] = createSignal<Severity>();
  const severities: Severity[] = ['error', 'warning', 'proposal'];
  const visible = createMemo(() => props.diagnostics.filter(d => !filter() || d.severity === filter()));
  createEffect(() => {
    const severity = filter();
    if (severity && !props.diagnostics.some(issue => issue.severity === severity)) setFilter(undefined);
  });
  return <Show when={props.diagnostics.length}>
    <NoteInfoPanel title="DIAGNOSTICS" class="diagnostics-panel" expanded={expanded()} onExpandedChange={setExpanded} actions={
      <For each={severities}>{severity => <Button class={`diagnostic-count severity-${severity}`} aria-pressed={filter() === severity} onClick={() => { setFilter(filter() === severity ? undefined : severity); setExpanded(true); }}>{props.diagnostics.filter(d => d.severity === severity).length} {severity === 'proposal' ? 'proposals' : `${severity}s`}</Button>}</For>
    }>
        <div class="diagnostics-list">
          <For each={visible()}>{diagnostic => <div class={`diagnostic-row severity-${diagnostic.severity}`}>
            <Button class="diagnostic-location" disabled={!diagnostic.note_id || !props.noteIds.includes(diagnostic.note_id)} busy={props.busy} title={diagnostic.document ?? undefined} onClick={() => { if (!props.busy) props.onOpen(diagnostic); }}>{diagnostic.note_id ?? 'Library'}{diagnostic.line ? `:${diagnostic.line}` : ''}</Button>
            <details class="diagnostic-detail">
              <summary><span class="diagnostic-code">{diagnostic.code}</span> {diagnostic.message.split('\n')[0]}</summary>
              <pre>{diagnostic.message}</pre>
              <Show when={diagnostic.document}><div class="diagnostic-file">{diagnostic.document}{diagnostic.line ? `:${diagnostic.line}:${diagnostic.column ?? 1}` : ''}</div></Show>
              <For each={diagnostic.actions}>{action => <div class="diagnostic-proposal-action">{action.title}</div>}</For>
            </details>
          </div>}</For>
        </div>
    </NoteInfoPanel>
  </Show>;
}
