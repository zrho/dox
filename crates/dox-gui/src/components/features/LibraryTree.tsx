import { createSignal, createUniqueId, For, Show } from "solid-js";
import Folder from "lucide-solid/icons/folder";
import FolderOpen from "lucide-solid/icons/folder-open";
import CircleAlert from "lucide-solid/icons/circle-alert";
import NoteIcon from "./NoteIcon";
import NoteTitle, { titleText } from "./NoteTitle";
import type { Note } from "../../types";

/** Navigation tree, with its own selection and disclosure semantics. */
export default function LibraryTree(props: {
  path: string;
  notes: Note[];
  activeId?: string;
  busy: boolean;
  onOpen: (id: string) => void;
}) {
  const [expanded, setExpanded] = createSignal(true);
  const [focusedId, setFocusedId] = createSignal<string | null>();
  const groupId = createUniqueId();
  let root: HTMLDivElement | undefined;
  let folder: HTMLDivElement | undefined;
  const name = () => props.path.split("/").filter(Boolean).pop() || props.path;
  const visibleRows = () =>
    Array.from(
      root?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [],
    ).filter((row) => !row.closest("[hidden]"));
  function focusRow(index: number) {
    const rows = visibleRows();
    rows[Math.max(0, Math.min(index, rows.length - 1))]?.focus();
  }
  function onKey(event: KeyboardEvent) {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      target.getAttribute("role") !== "treeitem"
    )
      return;
    const rows = visibleRows();
    const index = rows.indexOf(target);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusRow(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusRow(0);
        break;
      case "End":
        event.preventDefault();
        focusRow(rows.length - 1);
        break;
      case "ArrowRight":
        if (target === folder) {
          event.preventDefault();
          if (!expanded()) setExpanded(true);
          else focusRow(1);
        }
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (target === folder) setExpanded(false);
        else folder?.focus();
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        target.click();
        break;
    }
  }
  const tabStop = () => {
    if (focusedId() === null) return undefined;
    const id = focusedId() ?? props.activeId;
    return expanded() && props.notes.some((note) => note.id === id)
      ? id
      : undefined;
  };
  return (
    <Show when={props.path}>
      <div
        ref={root}
        role="tree"
        aria-label={`Library: ${name()}`}
        onKeyDown={onKey}
      >
        <div
          ref={folder}
          role="treeitem"
          aria-level={1}
          aria-expanded={expanded()}
          aria-owns={expanded() ? groupId : undefined}
          tabIndex={tabStop() ? -1 : 0}
          title={props.path}
          class="flex h-5 cursor-pointer items-center gap-1 px-1 text-xs leading-[18px] font-medium hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          onFocus={() => setFocusedId(null)}
          onClick={() => setExpanded(!expanded())}
        >
          <Show
            when={expanded()}
            fallback={
              <Folder
                class="size-3 shrink-0 text-accent"
                strokeWidth={1.5}
                aria-hidden="true"
              />
            }
          >
            <FolderOpen
              class="size-3 shrink-0 text-accent"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          </Show>
          <span class="truncate">{name()}</span>
        </div>
        <div
          id={groupId}
          role="group"
          hidden={!expanded()}
          class="relative before:pointer-events-none before:absolute before:inset-y-0 before:left-[10px] before:z-1 before:w-px before:bg-border before:content-['']"
        >
          <For each={props.notes}>
            {(note) => (
              <LibraryTreeRow
                note={note}
                active={props.activeId === note.id}
                tabIndex={tabStop() === note.id ? 0 : -1}
                busy={props.busy}
                onFocus={() => setFocusedId(note.id)}
                onOpen={props.onOpen}
              />
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

function LibraryTreeRow(props: {
  note: Note;
  active: boolean;
  tabIndex: number;
  busy: boolean;
  onFocus: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div
      role="treeitem"
      aria-level={2}
      aria-selected={props.active}
      aria-disabled={props.busy}
      tabIndex={props.tabIndex}
      onFocus={props.onFocus}
      class="group flex h-5 w-full cursor-pointer items-center gap-1 pr-[6px] pl-[18px] text-xs leading-[18px] hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-selected:bg-selection"
      onClick={() => {
        if (!props.busy) props.onOpen(props.note.id);
      }}
    >
      <NoteIcon
        type={props.note.metadata.type}
        class={
          props.active
            ? "size-3 shrink-0 text-accent"
            : "size-3 shrink-0 text-muted"
        }
      />
      <span class="min-w-0 flex-1 truncate" title={titleText(props.note)}>
        <NoteTitle note={props.note} />
      </span>
      <Show
        when={props.note.diagnostics.some(
          (issue) => issue.severity === "error",
        )}
      >
        <span class="flex shrink-0 text-destructive" aria-label="Has errors">
          <CircleAlert size={10} strokeWidth={1.5} aria-hidden="true" />
        </span>
      </Show>
      <span
        class="shrink-0 font-mono text-[9px] text-subtle group-hover:block group-focus-visible:block"
        classList={{ hidden: !props.active }}
      >
        {props.note.id}
      </span>
    </div>
  );
}
