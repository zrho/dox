import NoteView from "./NoteView";
import type { Note } from "../../types";
/** Both panes remain mounted to preserve selection and rendered scroll state. */
export default function NoteWorkspace(props: {
  note: Note;
  mode: "edit" | "view";
  source: string;
  html: string;
  active?: boolean;
  readOnly?: boolean;
  editorZoom: number;
  viewZoom: number;
  onSourceChange: (source: string) => void;
  onNavigate: (id: string) => void;
  getNoteTitle: (id: string) => string | undefined;
  editorRef: (element: HTMLTextAreaElement) => void;
}) {
  return (
    <div class="relative min-h-[120px] flex-1 overflow-hidden bg-document-background">
      <div class="h-full min-h-0 hidden:hidden" hidden={props.mode !== "view"}>
        <NoteView
          html={props.html}
          zoom={props.viewZoom}
          active={props.mode === "view" && props.active !== false}
          getNoteTitle={props.getNoteTitle}
          onNavigate={props.onNavigate}
        />
      </div>
      <div class="h-full min-h-0 hidden:hidden" hidden={props.mode !== "edit"}>
        <textarea
          ref={props.editorRef}
          class="h-full w-full resize-none rounded-none border-0 bg-document-background px-3 py-2 font-editor leading-[1.5] text-document-foreground outline-none selection:bg-document-selection selection:text-document-foreground [color-scheme:light] [tab-size:2]"
          style={{ "font-size": `${(13 * props.editorZoom) / 100}px` }}
          aria-label={
            props.note.metadata.type === "literature"
              ? "BibTeX source"
              : "Typst source"
          }
          readOnly={props.readOnly}
          spellcheck={false}
          value={props.source}
          onKeyDown={(event) => {
            if (
              event.key !== "Tab" || event.shiftKey || event.metaKey ||
              event.ctrlKey || event.altKey || event.isComposing ||
              event.currentTarget.readOnly
            ) return;
            event.preventDefault();
            const editor = event.currentTarget;
            // Use a native editing operation so Tab participates in undo.
            if (!document.execCommand("insertText", false, "  "))
              editor.setRangeText("  ", editor.selectionStart, editor.selectionEnd, "end");
            props.onSourceChange(editor.value);
          }}
          onInput={(event) => props.onSourceChange(event.currentTarget.value)}
        />
      </div>
    </div>
  );
}
