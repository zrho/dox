import { Dialog } from '@kobalte/core/dialog';
import { createEffect, createMemo, createSignal, createUniqueId, For, Show, type JSX } from 'solid-js';
import TextInput from './TextInput';
import { fuzzyMatch, type Match } from './fuzzy';

export type FuzzyPickerProps<T> = {
  open: boolean;
  title: string;
  label?: string;
  listLabel: string;
  placeholder: string;
  shortcut?: string;
  emptyText?: string;
  items: T[];
  searchTexts: (item: T) => string[];
  compare: (a: T, b: T) => number;
  renderItem: (item: T, matches: (Match | undefined)[]) => JSX.Element;
  disabled?: (item: T) => boolean;
  dimDisabled?: boolean;
  busy?: boolean;
  /** Commands run after focus restoration; note insertion runs before it. */
  selectAfterClose?: boolean;
  onSelect: (item: T) => void;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
};

/** Shared fuzzy ranking, dialog, keyboard navigation, selection, and focus. */
export default function FuzzyPicker<T>(props: FuzzyPickerProps<T>) {
  const [query, setQuery] = createSignal('');
  const [selected, setSelected] = createSignal(0);
  const listId = createUniqueId();
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  let pending: { item: T } | undefined;
  const results = createMemo(() => {
    const needle = query().trim().toLowerCase().replace(/\s+/g, '');
    return props.items.flatMap(item => {
      const matches = props.searchTexts(item).map(text => fuzzyMatch(text, needle));
      const score = Math.max(...matches.map(match => match?.score ?? -Infinity));
      return score > -Infinity ? [{ item, matches, score }] : [];
    }).sort((a, b) => b.score - a.score || props.compare(a.item, b.item));
  });
  createEffect(() => { if (props.open) { setQuery(''); setSelected(0); } });
  createEffect(() => { results(); setSelected(0); });
  createEffect(() => {
    const active = selected();
    if (props.open) queueMicrotask(() => list?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }));
  });
  const disabled = (item: T) => !!props.busy || !!props.disabled?.(item);
  function choose(index: number) {
    const result = results()[index];
    if (!result || disabled(result.item)) return;
    if (props.selectAfterClose) pending = { item: result.item };
    props.onOpenChange(false);
    if (!props.selectAfterClose) props.onSelect(result.item);
  }
  function onKey(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const count = results().length;
      if (count) setSelected(value => (value + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
    } else if (event.key === 'Enter') { event.preventDefault(); choose(selected()); }
  }
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay class="picker-overlay"/>
      <Dialog.Content class="fuzzy-picker" onOpenAutoFocus={event => { pending = undefined; event.preventDefault(); input?.focus(); }} onCloseAutoFocus={event => {
        props.onCloseAutoFocus?.(event);
        const choice = pending; pending = undefined;
        if (choice) setTimeout(() => props.onSelect(choice.item), 0);
      }}>
        <Dialog.Title class="sr-only">{props.title}</Dialog.Title>
        <div class="picker-input-row">
          <TextInput ref={input} class="picker-input" aria-label={props.label ?? props.title} role="combobox" aria-autocomplete="list" aria-expanded={props.open} aria-controls={listId} aria-activedescendant={results().length ? `${listId}-${selected()}` : undefined} placeholder={props.placeholder} autocomplete="off" spellcheck={false} value={query()} onInput={event => setQuery(event.currentTarget.value)} onKeyDown={onKey}/>
          <Show when={props.shortcut}><kbd>{props.shortcut}</kbd></Show>
        </div>
        <div ref={list} id={listId} class="picker-results" role="listbox" aria-label={props.listLabel} aria-busy={props.busy}>
          <For each={results()}>{(result, index) => <div id={`${listId}-${index()}`} role="option" aria-selected={selected() === index()} aria-disabled={disabled(result.item)} class="picker-result" classList={{ 'picker-result-selected': selected() === index(), 'picker-result-disabled': !!props.dimDisabled && disabled(result.item) }} data-index={index()} onMouseMove={() => setSelected(index())} onMouseDown={event => event.preventDefault()} onClick={() => choose(index())}>
            {props.renderItem(result.item, result.matches)}
          </div>}</For>
          <Show when={!results().length}><div class="picker-empty" role="status">{props.emptyText ?? 'No matches'}</div></Show>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog>;
}
