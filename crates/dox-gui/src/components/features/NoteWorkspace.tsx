import NoteView from "./NoteView";
import type { Note } from "../../types";
/** Both panes remain mounted to preserve selection and rendered scroll state. */
export default function NoteWorkspace(props: {
  note: Note;
  mode: "edit" | "view";
  source: string;
  html: string;
  onSourceChange: (source: string) => void;
  onNavigate: (id: string) => void;
  getNoteTitle: (id: string) => string | undefined;
  editorRef: (element: HTMLTextAreaElement) => void;
}) {
  return (
    <div class="relative min-h-[120px] flex-1 overflow-hidden bg-background">
      <div class="h-full min-h-0 hidden:hidden" hidden={props.mode !== "view"}>
        <NoteView
          html={props.html}
          active={props.mode === "view"}
          getNoteTitle={props.getNoteTitle}
          onNavigate={props.onNavigate}
        />
      </div>
      <div class="h-full min-h-0 hidden:hidden" hidden={props.mode !== "edit"}>
        <textarea
          ref={props.editorRef}
          class="h-full w-full resize-none rounded-none border-0 bg-background px-3 py-2 font-mono text-[13px] leading-[1.5] text-editor outline-none [tab-size:2]"
          aria-label={
            props.note.metadata.type === "literature"
              ? "BibTeX source"
              : "Typst source"
          }
          spellcheck={false}
          value={props.source}
          onInput={(event) => props.onSourceChange(event.currentTarget.value)}
        />
      </div>
    </div>
  );
}
