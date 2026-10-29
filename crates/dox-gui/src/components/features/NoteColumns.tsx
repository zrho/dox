import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import X from "lucide-solid/icons/x";
import Button from "../ui/Button";
import NoteTitle, { titleText } from "./NoteTitle";
import NoteWorkspace from "./NoteWorkspace";
import BacklinksPanel from "./BacklinksPanel";
import type { Note, NoteColumn } from "../../types";

const MAX_WIDTH = 640;
const MIN_WIDTH = 280;
const MIN_STRIP = 40;
const VERTICAL_TITLE_THRESHOLD = 96;

type ColumnLayout = { width: number; left: number; exposed: number };

/** A trail of overlapping sheets. Only the column geometry changes on activation. */
export default function NoteColumns(props: {
  columns: NoteColumn[];
  activeKey?: number;
  notes: Note[];
  busy: boolean;
  onActivate: (key: number) => void;
  onClose: (key: number) => void;
  onNavigate: (id: string, fromKey: number) => void;
  onSourceChange: (key: number, source: string) => void;
  getNoteTitle: (id: string) => string | undefined;
  bindEditor: (key: number, element: HTMLTextAreaElement) => void;
  unbindEditor: (key: number) => void;
}) {
  let viewport!: HTMLDivElement;
  const [availableWidth, setAvailableWidth] = createSignal(MAX_WIDTH);
  onMount(() => {
    setAvailableWidth(viewport.clientWidth);
    const observer = new ResizeObserver((entries) =>
      setAvailableWidth(entries[0].contentRect.width),
    );
    observer.observe(viewport);
    onCleanup(() => observer.disconnect());
  });
  const layout = createMemo(() => {
    const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, availableWidth()));
    const active = Math.max(
      0,
      props.columns.findIndex((column) => column.key === props.activeKey),
    );
    const step = active
      ? Math.min(
          width,
          Math.max(MIN_STRIP, (availableWidth() - width) / active),
        )
      : width;
    const positions = props.columns.map((_, index) =>
      index <= active ? index * step : active * step + (index - active) * width,
    );
    return positions.map((left, index): ColumnLayout => ({
      width,
      left,
      exposed:
        index + 1 < positions.length
          ? Math.min(width, positions[index + 1] - left)
          : width,
    }));
  });
  const canvasWidth = () => {
    const last = layout().at(-1);
    return last
      ? Math.max(availableWidth(), last.left + last.width)
      : availableWidth();
  };
  createEffect(() => {
    const active = props.columns.findIndex(
      (column) => column.key === props.activeKey,
    );
    const placement = layout()[active];
    if (!placement) return;
    const left = Math.max(
      0,
      placement.left + placement.width - availableWidth(),
    );
    // When there are too many minimum-width strips, retain horizontal scrolling.
    queueMicrotask(() => {
      if (viewport) viewport.scrollLeft = left;
    });
  });
  return (
    <div
      ref={viewport}
      class="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden bg-panel"
      aria-label="Note columns"
    >
      <div class="relative h-full" style={{ width: `${canvasWidth()}px` }}>
        <For each={props.columns}>
          {(column, index) => (
            <NoteColumnPanel
              column={column}
              placement={
                layout()[index()] ?? {
                  width: MAX_WIDTH,
                  left: 0,
                  exposed: MAX_WIDTH,
                }
              }
              active={props.activeKey === column.key}
              order={index()}
              busy={props.busy}
              notes={props.notes}
              onActivate={() => props.onActivate(column.key)}
              onClose={() => props.onClose(column.key)}
              onNavigate={(id) => props.onNavigate(id, column.key)}
              onSourceChange={(source) =>
                props.onSourceChange(column.key, source)
              }
              getNoteTitle={props.getNoteTitle}
              editorRef={(element) => props.bindEditor(column.key, element)}
              onDispose={() => props.unbindEditor(column.key)}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function NoteColumnPanel(props: {
  column: NoteColumn;
  placement: ColumnLayout;
  active: boolean;
  order: number;
  busy: boolean;
  notes: Note[];
  onActivate: () => void;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onSourceChange: (source: string) => void;
  getNoteTitle: (id: string) => string | undefined;
  editorRef: (element: HTMLTextAreaElement) => void;
  onDispose: () => void;
}) {
  onCleanup(props.onDispose);
  let pointerDown = false;
  const collapsed = () => props.placement.exposed <= VERTICAL_TITLE_THRESHOLD;
  const note = () => props.column.document.note;
  const dirty = () => props.column.source !== props.column.document.source;
  const backlinks = createMemo(() =>
    props.notes.filter((candidate) => candidate.links.includes(note().id)),
  );
  return (
    <section
      class="absolute inset-y-0 flex flex-col border-t-2 border-r border-border bg-background shadow-lg shadow-crust/40"
      classList={{
        "border-t-accent": props.active,
        "border-t-border": !props.active,
      }}
      style={{
        left: `${props.placement.left}px`,
        width: `${props.placement.width}px`,
        "z-index": props.order + 1,
      }}
      aria-label={`${titleText(note())}${dirty() ? " (unsaved)" : ""}`}
      onPointerDown={(event) => {
        pointerDown = true;
        if (props.busy && !props.active) event.preventDefault();
      }}
      onPointerUp={() => {
        pointerDown = false;
      }}
      onPointerCancel={() => {
        pointerDown = false;
      }}
      onClick={props.onActivate}
      onFocusIn={() => {
        if (!pointerDown) props.onActivate();
      }}
    >
      <header
        class="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2"
        inert={collapsed()}
      >
        <button
          type="button"
          class="min-w-0 flex-1 cursor-pointer truncate text-left text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          onClick={props.onActivate}
          title={titleText(note())}
        >
          <NoteTitle note={note()} />
        </button>
        <Show when={dirty()}>
          <span class="text-[10px] text-warning" aria-label="Unsaved">
            ●
          </span>
        </Show>
        <Button
          size="icon"
          aria-label={`Close ${titleText(note())}`}
          busy={props.busy}
          onClick={(event) => {
            event.stopPropagation();
            props.onClose();
          }}
        >
          <X size={12} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </header>
      <div class="flex min-h-0 flex-1 flex-col" inert={collapsed()}>
        <NoteWorkspace
          note={note()}
          mode={props.column.mode}
          source={props.column.source}
          html={props.column.html}
          editorZoom={props.column.editorZoom}
          viewZoom={props.column.viewZoom}
          active={!collapsed()}
          readOnly={props.busy || !props.active}
          onSourceChange={props.onSourceChange}
          onNavigate={props.onNavigate}
          getNoteTitle={props.getNoteTitle}
          editorRef={props.editorRef}
        />
        <BacklinksPanel
          notes={backlinks()}
          busy={props.busy}
          onOpen={props.onNavigate}
        />
      </div>
      <Show when={collapsed()}>
        <button
          type="button"
          class="absolute inset-y-0 left-0 flex w-10 cursor-pointer items-center gap-3 overflow-hidden border-r border-border bg-panel py-3 text-xs text-muted hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [writing-mode:vertical-rl]"
          aria-label={`Reveal ${titleText(note())}`}
          onClick={props.onActivate}
        >
          <span class="min-h-0 overflow-hidden text-ellipsis whitespace-nowrap">
            {titleText(note())}
          </span>
          <Show when={dirty()}>
            <span class="text-warning" aria-label="Unsaved">
              ●
            </span>
          </Show>
        </button>
      </Show>
    </section>
  );
}
