import { cn } from "../../utils/cn";
import { Dialog } from "@kobalte/core/dialog";
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Show,
  type JSX,
} from "solid-js";
import TextInput from "./TextInput";
import Kbd from "./Kbd";

export type Match = { score: number; positions: number[] };

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
    for (let queryIndex = 0; queryIndex < query.length; queryIndex++) {
      const char = query[queryIndex];
      const found = lower.indexOf(char, cursor);
      if (found < 0) break;
      const previous = positions.at(-1);
      score += 10;
      if (previous !== undefined)
        score += found === previous + 1 ? 18 : -(found - previous - 1);
      if (found === 0 || /[\s_\-/.:]/.test(text[found - 1])) score += 14;
      if (
        found > 0 &&
        /[a-z]/.test(text[found - 1]) &&
        /[A-Z]/.test(text[found])
      )
        score += 8;
      positions.push(found);
      cursor = found + 1;
    }
    if (positions.length === query.length && (!best || score > best.score))
      best = { score, positions };
  }
  return best;
}

export function MatchText(props: { text: string; positions: number[] }) {
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
  return (
    <For each={segments()}>
      {(part) => (
        <span class={part.matched ? "text-link font-semibold" : undefined}>
          {part.text}
        </span>
      )}
    </For>
  );
}

export type FuzzyPickerProps<T> = {
  open: boolean;
  class?: string;
  listClass?: string;
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

/** Shared fuzzy matching, highlighting, and picker interaction in one module. */
export default function FuzzyPicker<T>(props: FuzzyPickerProps<T>) {
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal(0);
  const listId = createUniqueId();
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;
  let pending: { item: T } | undefined;
  const results = createMemo(() => {
    const needle = query().trim().toLowerCase().replace(/\s+/g, "");
    return props.items
      .flatMap((item) => {
        const matches = props
          .searchTexts(item)
          .map((text) => fuzzyMatch(text, needle));
        const score = Math.max(
          ...matches.map((match) => match?.score ?? -Infinity),
        );
        return score > -Infinity ? [{ item, matches, score }] : [];
      })
      .sort((a, b) => b.score - a.score || props.compare(a.item, b.item));
  });
  createEffect(() => {
    if (props.open) {
      setQuery("");
      setSelected(0);
    }
  });
  createEffect(() => {
    results();
    setSelected(0);
  });
  createEffect(() => {
    const active = selected();
    if (props.open)
      queueMicrotask(() =>
        list
          ?.querySelector(`[data-index="${active}"]`)
          ?.scrollIntoView({ block: "nearest" }),
      );
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
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = results().length;
      if (count)
        setSelected(
          (value) =>
            (value + (event.key === "ArrowDown" ? 1 : -1) + count) % count,
        );
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(selected());
    }
  }
  const onOpenAutoFocus = (event: Event) => {
    pending = undefined;
    event.preventDefault();
    input?.focus();
  };
  const onCloseAutoFocus = (event: Event) => {
    props.onCloseAutoFocus?.(event);
    const choice = pending;
    pending = undefined;
    if (choice) setTimeout(() => props.onSelect(choice.item), 0);
  };
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-20 bg-crust/60" />
        <Dialog.Content
          class={cn(
            "fixed top-[14vh] left-1/2 z-21 w-[min(560px,calc(100vw_-_48px))] -translate-x-1/2 overflow-hidden rounded-[7px] border border-border-strong bg-panel shadow-[0_16px_64px] shadow-crust/60",
            props.class,
          )}
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <Dialog.Title class="sr-only">{props.title}</Dialog.Title>
          <div class="flex items-center gap-3 border-b border-border px-[13px] py-2">
            <TextInput
              variant="search"
              ref={(element) => {
                input = element;
              }}
              aria-label={props.label ?? props.title}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={props.open}
              aria-controls={listId}
              aria-activedescendant={
                results().length ? `${listId}-${selected()}` : undefined
              }
              placeholder={props.placeholder}
              autocomplete="off"
              spellcheck={false}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={onKey}
            />
            <Show when={props.shortcut}>
              <Kbd>{props.shortcut}</Kbd>
            </Show>
          </div>
          <div
            ref={(element) => {
              list = element;
            }}
            id={listId}
            class={cn(
              "max-h-[min(360px,60vh)] overflow-y-auto overscroll-contain p-1",
              props.listClass,
            )}
            role="listbox"
            aria-label={props.listLabel}
            aria-busy={props.busy}
          >
            <For each={results()}>
              {(result, index) => (
                <div
                  id={`${listId}-${index()}`}
                  role="option"
                  aria-selected={selected() === index()}
                  aria-disabled={disabled(result.item)}
                  class="flex min-h-7 cursor-pointer items-center gap-4 rounded-[3px] px-[9px] py-[3px] text-xs aria-selected:bg-picker-selection aria-selected:text-foreground"
                  classList={{
                    "cursor-default opacity-40":
                      !!props.dimDisabled && disabled(result.item),
                  }}
                  data-index={index()}
                  onMouseMove={() => setSelected(index())}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(index())}
                >
                  {props.renderItem(result.item, result.matches)}
                </div>
              )}
            </For>
            <Show when={!results().length}>
              <div class="px-[9px] py-3 text-xs text-muted">
                {props.emptyText ?? "No matches"}
              </div>
            </Show>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
