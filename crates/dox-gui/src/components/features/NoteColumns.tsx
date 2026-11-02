import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import Paperclip from "lucide-solid/icons/paperclip";
import { titleText } from "./NoteTitle";
import NoteWorkspace from "./NoteWorkspace";
import BacklinksPanel from "./BacklinksPanel";
import AttachmentsPanel from "./AttachmentsPanel";
import { createColumnDrag } from "../../hooks/createColumnDrag";
import { createAttachmentDrop } from "../../hooks/createAttachmentDrop";
import type { Note, NoteColumn } from "../../types";

const MAX_WIDTH = 520;
const MIN_WIDTH = 280;
/** Horizontally scrollable panes; transforms animate their reorder positions. */
export default function NoteColumns(props: {
  columns: NoteColumn[];
  activeKey?: number;
  revealRequest: number;
  notes: Note[];
  busy: boolean;
  onActivate: (key: number) => void;
  onMove: (key: number, index: number) => void;
  onAttach: (id: string) => void;
  onDropFiles: (id: string, paths: string[]) => void;
  onError: (error: unknown) => void;
  onOpenAttachment: (id: string, name: string) => void;
  onRemoveAttachment: (id: string, name: string) => void;
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
  const columnWidth = () =>
    Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, availableWidth()));
  const drag = createColumnDrag({
    columns: () => props.columns,
    width: columnWidth,
    viewport: () => viewport,
    enabled: () => !props.busy,
    onActivate: props.onActivate,
    onMove: props.onMove,
  });
  const fileDrop = createAttachmentDrop({
    enabled: () => !props.busy && !drag.interacting(),
    targetAt: (x, y) => {
      const panel = document.elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-note-column-key]");
      if (!panel || !viewport.contains(panel)) return;
      const key = Number(panel.dataset.noteColumnKey);
      return props.columns.some((column) => column.key === key) ? key : undefined;
    },
    onDrop: (key, paths) => {
      const column = props.columns.find((column) => column.key === key);
      if (!column) return;
      props.onActivate(key);
      props.onDropFiles(column.document.note.id, paths);
    },
    onError: props.onError,
  });
  function preventFileDropDefault(event: DragEvent) {
    // Let the native drop handler attach the files rather than letting an
    // editor insert their paths or the browser navigate to a dropped file.
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  }
  let revealRequest = 0;
  createEffect(() => {
    const index = props.columns.findIndex(
      (column) => column.key === props.activeKey,
    );
    const width = columnWidth();
    // An already-active pane may have been manually scrolled out of view.
    const explicitRequest = props.revealRequest;
    const request = ++revealRequest;
    if (drag.interacting() || index < 0) return;
    // Reveal a newly selected column only as far as necessary. Scrolling itself
    // neither changes selection nor rearranges the row.
    queueMicrotask(() => {
      if (request !== revealRequest || explicitRequest !== props.revealRequest || !viewport) return;
      const left = index * width;
      const right = left + width;
      if (left < viewport.scrollLeft) viewport.scrollLeft = left;
      else if (right > viewport.scrollLeft + viewport.clientWidth)
        viewport.scrollLeft = right - viewport.clientWidth;
    });
  });
  return (
    <div
      ref={viewport}
      class="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain bg-panel [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      classList={{ "select-none": drag.draggingKey() !== undefined }}
      aria-label="Note columns"
      onDragOver={preventFileDropDefault}
      onDrop={preventFileDropDefault}
    >
      <div class="relative mx-auto h-full" style={{ width: `${props.columns.length * columnWidth()}px` }}>
        <For each={props.columns}>
          {(column, index) => (
            <NoteColumnPanel
              column={column}
              width={columnWidth()}
              left={drag.left(column.key, index())}
              dragging={drag.draggingKey() === column.key}
              dropTarget={fileDrop.target() === column.key}
              active={props.activeKey === column.key}
              busy={props.busy}
              notes={props.notes}
              onActivate={() => props.onActivate(column.key)}
              onAttach={() => props.onAttach(column.document.note.id)}
              onOpenAttachment={(name) => props.onOpenAttachment(column.document.note.id, name)}
              onRemoveAttachment={(name) => props.onRemoveAttachment(column.document.note.id, name)}
              onDragStart={(event) => drag.start(column.key, event)}
              onDragMove={drag.move}
              onDragEnd={drag.end}
              onDragCancel={drag.cancel}
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
  width: number;
  left: number;
  dragging: boolean;
  dropTarget: boolean;
  active: boolean;
  busy: boolean;
  notes: Note[];
  onActivate: () => void;
  onAttach: () => void;
  onOpenAttachment: (name: string) => void;
  onRemoveAttachment: (name: string) => void;
  onDragStart: (event: PointerEvent & { currentTarget: HTMLButtonElement }) => void;
  onDragMove: (event: PointerEvent) => void;
  onDragEnd: (event: PointerEvent) => void;
  onDragCancel: (event: PointerEvent) => void;
  onNavigate: (id: string) => void;
  onSourceChange: (source: string) => void;
  getNoteTitle: (id: string) => string | undefined;
  editorRef: (element: HTMLTextAreaElement) => void;
  onDispose: () => void;
}) {
  onCleanup(props.onDispose);
  let pointerDown = false;
  const note = () => props.column.document.note;
  const dirty = () => props.column.source !== props.column.document.source;
  const backlinks = createMemo(() =>
    props.notes.filter((candidate) => candidate.links.includes(note().id)),
  );
  return (
    <section
      data-note-column-key={props.column.key}
      class="absolute top-0 left-0 flex h-full flex-col border-r border-border bg-background motion-safe:transition-[transform,box-shadow] motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.2,0.8,0.2,1)]"
      classList={{
        "z-10": props.dragging,
        "shadow-lg": props.dragging,
        "shadow-overlay/25": props.dragging,
        "will-change-transform": props.dragging,
      }}
      style={{
        width: `${props.width}px`,
        transform: `translateX(${props.left}px)`,
        transition: props.dragging ? "none" : undefined,
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
      onLostPointerCapture={() => {
        pointerDown = false;
      }}
      onClick={props.onActivate}
      onFocusIn={() => {
        if (!pointerDown) props.onActivate();
      }}
    >
      <Show when={props.dropTarget}>
        <div
          role="status"
          class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-accent bg-selection/60"
        >
          <div class="flex items-center gap-2 rounded border border-border-strong bg-popover px-3 py-2 text-xs text-foreground shadow-md">
            <Paperclip size={16} strokeWidth={1.5} aria-hidden="true" />
            Drop files to attach
          </div>
        </div>
      </Show>
      <div class="group shrink-0 select-none">
        <div
          aria-hidden="true"
          class="h-[2px] transition-colors motion-reduce:transition-none"
          classList={{ "bg-accent": props.active, "bg-border": !props.active }}
        />
        <header class="flex h-2 items-stretch">
          <button
            type="button"
            class="min-w-0 flex-1 touch-none self-stretch select-none outline-none"
            classList={{ "cursor-grab": !props.dragging, "cursor-grabbing": props.dragging }}
            onPointerDown={props.onDragStart}
            onPointerMove={props.onDragMove}
            onPointerUp={props.onDragEnd}
            onPointerCancel={props.onDragCancel}
            onLostPointerCapture={props.onDragCancel}
            onClick={props.onActivate}
            aria-label={`Drag ${titleText(note())} to reorder`}
          >
            <span
              aria-hidden="true"
              class="pointer-events-none mx-auto my-[3px] block h-[2px] w-6 rounded-full bg-border-strong opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
            />
          </button>
        </header>
      </div>
      <div class="flex min-h-0 flex-1 flex-col">
        <NoteWorkspace
          note={note()}
          mode={props.column.mode}
          source={props.column.source}
          html={props.column.html}
          editorZoom={props.column.editorZoom}
          viewZoom={props.column.viewZoom}
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
        <AttachmentsPanel
          attachments={props.column.document.attachments}
          busy={props.busy}
          onAttach={props.onAttach}
          onOpen={props.onOpenAttachment}
          onRemove={props.onRemoveAttachment}
        />
      </div>
      <footer
        aria-label="Item metadata"
        class="flex h-[22px] shrink-0 items-center gap-3 border-t border-border bg-chrome px-2 text-[10px] text-muted tabular-nums"
      >
        <Show when={dirty()}>
          <span class="text-warning" aria-label="Unsaved">●</span>
        </Show>
        <Show when={note().metadata.date}>
          <time dateTime={note().metadata.date}>{note().metadata.date}</time>
        </Show>
        <span class="ml-auto font-mono">{note().id}</span>
      </footer>
    </section>
  );
}
