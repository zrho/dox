import { cn } from "../../utils/cn";
import Dialog from "./Dialog";
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  For,
  Show,
  type JSX,
} from "solid-js";
import TextInput from "./TextInput";
import Kbd from "./Kbd";

export type Match = { score: number; positions: number[] };

export type FuzzyResult = {
  index: number;
  matches: (Match | null)[];
  score: number;
};

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
  findMatches: (
    query: string,
    candidates: string[][],
  ) => Promise<FuzzyResult[]>;
  renderItem: (item: T, matches: (Match | null)[]) => JSX.Element;
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
  const [results, setResults] = createSignal<
    { item: T; matches: (Match | null)[]; score: number }[]
  >([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  let generation = 0;
  onCleanup(() => {
    ++generation;
  });
  createEffect(() => {
    if (props.open) {
      setQuery("");
      setSelected(0);
    }
  });
  createEffect(() => {
    const request = ++generation;
    if (!props.open) {
      setLoading(false);
      return;
    }
    const needle = query();
    const items = Array.from(props.items);
    const candidates = items.map((item) => props.searchTexts(item));
    setLoading(true);
    setError("");
    // A response belongs only to its query and candidate snapshot.
    void props
      .findMatches(needle, candidates)
      .then((matches) => {
        if (request !== generation) return;
        setResults(
          matches.map((match) => ({
            item: items[match.index],
            matches: match.matches,
            score: match.score,
          })),
        );
        setSelected(0);
        setLoading(false);
      })
      .catch((error) => {
        if (request !== generation) return;
        setError(String(error));
        setResults([]);
        setLoading(false);
      });
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
    if (!result || loading() || error() || disabled(result.item)) return;
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
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.title}
      class={props.class}
      onOpenAutoFocus={onOpenAutoFocus}
      onCloseAutoFocus={onCloseAutoFocus}
    >
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
        aria-busy={props.busy || loading()}
      >
        <For each={results()}>
          {(result, index) => (
            <div
              id={`${listId}-${index()}`}
              role="option"
              aria-selected={selected() === index()}
              aria-disabled={loading() || disabled(result.item)}
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
        <Show when={error()}>
          <div role="alert" class="px-[9px] py-3 text-xs text-destructive">
            Could not search: {error()}
          </div>
        </Show>
        <Show when={!results().length && !error()}>
          <div class="px-[9px] py-3 text-xs text-muted">
            {loading()
              ? "Finding matches…"
              : (props.emptyText ?? "No matches")}
          </div>
        </Show>
      </div>
    </Dialog>
  );
}
