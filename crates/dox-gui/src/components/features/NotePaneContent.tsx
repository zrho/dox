import { createMemo, onCleanup, Show } from "solid-js";
import Paperclip from "lucide-solid/icons/paperclip";
import NoteWorkspace from "./NoteWorkspace";
import type { NoteEditorHandle } from "./NoteEditor";
import BacklinksPanel from "./BacklinksPanel";
import AttachmentsPanel from "./AttachmentsPanel";
import type { Note, NotePane } from "../../types";

/** Note-specific content and lifecycle within a shared workspace pane frame. */
export default function NotePaneContent(props: {
  pane: NotePane;
  active: boolean;
  busy: boolean;
  dropTarget: boolean;
  notes: Note[];
  onAttach: () => void;
  onOpenAttachment: (name: string) => void;
  onRemoveAttachment: (name: string) => void;
  onNavigate: (id: string) => void;
  onSourceChange: (source: string) => void;
  getNoteTitle: (id: string) => string | undefined;
  editorRef: (element: NoteEditorHandle) => void;
  onDispose: () => void;
}) {
  onCleanup(props.onDispose);
  const note = () => props.pane.document.note;
  const dirty = () => props.pane.source !== props.pane.document.source;
  const backlinks = createMemo(() =>
    props.notes.filter((candidate) => candidate.links.includes(note().id)),
  );
  return (
    <>
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
      <div class="flex min-h-0 flex-1 flex-col">
        <NoteWorkspace
          note={note()}
          mode={props.pane.mode}
          source={props.pane.source}
          html={props.pane.html}
          editorZoom={props.pane.editorZoom}
          viewZoom={props.pane.viewZoom}
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
          attachments={props.pane.document.attachments}
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
    </>
  );
}
