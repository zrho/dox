import { createEffect, createSignal, Show } from 'solid-js';

type NoteDateProps = {
  noteId: string;
  revision: string;
  value?: string;
  busy: boolean;
  onChange: (id: string, date: string, revision: string) => Promise<boolean>;
};

export default function NoteDate(props: NoteDateProps) {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  let input: HTMLInputElement | undefined;
  let original: { id: string; revision: string; date: string } | undefined;
  let cancelled = false;
  createEffect(() => {
    props.noteId;
    cancelled = true;
    original = undefined;
    setEditing(false);
  });
  function begin() {
    if (props.busy) return;
    cancelled = false;
    original = { id: props.noteId, revision: props.revision, date: props.value ?? '' };
    setDraft(original.date);
    setEditing(true);
    queueMicrotask(() => input?.focus());
  }
  async function commit() {
    if (cancelled || !original || saving() || props.busy) return;
    if (draft() === original.date) { setEditing(false); return; }
    if (!input?.checkValidity()) { input?.reportValidity(); return; }
    const snapshot = original;
    setSaving(true);
    try {
      if (await props.onChange(snapshot.id, draft(), snapshot.revision)) setEditing(false);
    } finally { setSaving(false); }
  }
  return <Show when={editing()} fallback={
    <button class="note-date" disabled={props.busy} title="Edit note date" aria-label={`Edit note date${props.value ? `: ${props.value}` : ''}`} onClick={begin}>
      <Show when={props.value} fallback={<span>Date</span>}><time dateTime={props.value}>{props.value}</time></Show>
    </button>
  }>
    <input
      ref={input}
      class="note-date-input"
      type="date"
      aria-label="Note date"
      required
      min="0001-01-01"
      max="9999-12-31"
      value={draft()}
      disabled={saving()}
      onInput={event => setDraft(event.currentTarget.value)}
      onBlur={() => void commit()}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void commit(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled = true; setEditing(false); }
      }}
    />
  </Show>;
}
