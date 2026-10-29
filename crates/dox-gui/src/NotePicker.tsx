import { Dialog } from '@kobalte/core/dialog';
import { createEffect, createMemo, createSignal, createUniqueId, For, Show } from 'solid-js';

type PickerNote = { id: string; title: string };
type Match = { score: number; positions: number[] };
type NotePickerProps = {
  open: boolean;
  notes: PickerNote[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
};

// Ordered subsequences, favoring adjacent characters and word boundaries.
function fuzzyMatch(text: string, query: string): Match | undefined {
  if (!query) return { score: 0, positions: [] };
  const lower = text.toLowerCase();
  let best: Match | undefined;
  for (let start = 0; start < lower.length; start++) {
    if (lower[start] !== query[0]) continue;
    const positions: number[] = [];
    let cursor = start;
    let score = -start - text.length * 0.01;
    for (const char of query) {
      const found = lower.indexOf(char, cursor);
      if (found < 0) break;
      const previous = positions.at(-1);
      score += 10;
      if (previous !== undefined) score += found === previous + 1 ? 18 : -(found - previous - 1);
      if (found === 0 || /[\s_\-/.:]/.test(text[found - 1])) score += 14;
      if (found > 0 && /[a-z]/.test(text[found - 1]) && /[A-Z]/.test(text[found])) score += 8;
      positions.push(found);
      cursor = found + 1;
    }
    if (positions.length === query.length && (!best || score > best.score)) best = { score, positions };
  }
  return best;
}

function MatchText(props: { text: string; positions: number[] }) {
  const segments = createMemo(() => {
    const matches = new Set(props.positions);
    const parts: { text: string; matched: boolean }[] = [];
    for (let i = 0; i < props.text.length; i++) {
      const matched = matches.has(i);
      const previous = parts.at(-1);
      if (previous?.matched === matched) previous.text += props.text[i];
      else parts.push({ text: props.text[i], matched });
    }
    return parts;
  });
  return <For each={segments()}>{part => <span classList={{ 'picker-match': part.matched }}>{part.text}</span>}</For>;
}

export default function NotePicker(props: NotePickerProps) {
  const [query, setQuery] = createSignal('');
  const [selected, setSelected] = createSignal(0);
  const listId = createUniqueId();
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  const results = createMemo(() => {
    const needle = query().trim().toLowerCase().replace(/\s+/g, '');
    return props.notes.flatMap(note => {
      const title = fuzzyMatch(note.title, needle);
      const id = fuzzyMatch(note.id, needle);
      if (!title && !id) return [];
      return [{ note, title, id, score: Math.max(title?.score ?? -Infinity, id?.score ?? -Infinity) }];
    }).sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title) || a.note.id.localeCompare(b.note.id));
  });
  createEffect(() => {
    if (props.open) { setQuery(''); setSelected(0); }
  });
  createEffect(() => {
    // Reset selection when the query or available notes change.
    results();
    setSelected(0);
  });
  createEffect(() => {
    const active = selected();
    if (props.open) queueMicrotask(() => list?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }));
  });
  function choose(index: number) {
    const result = results()[index];
    if (!result || props.busy) return;
    props.onOpenChange(false);
    props.onSelect(result.note.id);
  }
  function onKey(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const count = results().length;
      if (count) setSelected(value => (value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(selected());
    }
  }
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay class="picker-overlay"/>
      <Dialog.Content class="note-picker" onOpenAutoFocus={event => { event.preventDefault(); input?.focus(); }}>
        <Dialog.Title class="sr-only">Find note</Dialog.Title>
        <div class="picker-input-row">
          <input
            ref={input}
            class="picker-input"
            aria-label="Find note"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={props.open}
            aria-controls={listId}
            aria-activedescendant={results().length ? `${listId}-${selected()}` : undefined}
            placeholder="Find note…"
            autocomplete="off"
            spellcheck={false}
            value={query()}
            onInput={event => setQuery(event.currentTarget.value)}
            onKeyDown={onKey}
          />
          <kbd>⌘P</kbd>
        </div>
        <div ref={list} id={listId} class="picker-results" role="listbox" aria-label="Notes" aria-busy={props.busy}>
          <For each={results()}>{(result, index) =>
            <div
              id={`${listId}-${index()}`}
              role="option"
              aria-selected={selected() === index()}
              aria-disabled={props.busy}
              class="picker-result"
              classList={{ 'picker-result-selected': selected() === index() }}
              data-index={index()}
              onMouseMove={() => setSelected(index())}
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(index())}
            >
              <span class="picker-result-title"><MatchText text={result.note.title} positions={result.title?.positions ?? []}/></span>
              <span class="picker-result-id"><MatchText text={result.note.id} positions={result.id?.positions ?? []}/></span>
            </div>
          }</For>
          <Show when={!results().length}><div class="picker-empty" role="status">No matches</div></Show>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog>;
}
