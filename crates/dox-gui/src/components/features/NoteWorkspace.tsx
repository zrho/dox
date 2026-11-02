import NoteView from "./NoteView";
import NoteEditor, { type NoteEditorHandle } from "./NoteEditor";
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
  editorRef: (editor: NoteEditorHandle) => void;
}) {
  return (
    <div class="relative min-h-[120px] flex-1 overflow-hidden bg-document-background">
      <div class="h-full min-h-0 hidden:hidden" hidden={props.mode !== "view"}>
        <NoteView
          note={props.note}
          html={props.html}
          zoom={props.viewZoom}
          active={props.mode === "view" && props.active !== false}
          getNoteTitle={props.getNoteTitle}
          onNavigate={props.onNavigate}
        />
      </div>
      <div class="h-full min-h-0 hidden:hidden" hidden={props.mode !== "edit"}>
        <NoteEditor
          source={props.source}
          typst={props.note.metadata.type !== "literature"}
          visible={props.mode === "edit"}
          readOnly={props.readOnly}
          zoom={props.editorZoom}
          onSourceChange={props.onSourceChange}
          editorRef={props.editorRef}
        />
      </div>
    </div>
  );
}
