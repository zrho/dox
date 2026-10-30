export type Severity = "error" | "warning" | "proposal";
export type NotePickerMode = "open" | "insert" | "insert-with-title";
export type Diagnostic = {
  id: string;
  severity: Severity;
  code: string;
  message: string;
  note_id: string | null;
  document: string | null;
  line: number | null;
  column: number | null;
  target_note_id: string | null;
  actions: {
    kind: string;
    title: string;
    payload: unknown;
  }[];
};
export type Note = {
  id: string;
  title: string;
  title_text: string;
  title_html: string | null;
  tags: string[];
  links: string[];
  revision: string;
  diagnostic: string | null;
  diagnostics: Diagnostic[];
  metadata: {
    type: string;
    document: string;
    date?: string;
    pinned?: boolean;
  };
};
export type Document = {
  note: Note;
  source: string;
  attachments: Attachment[];
};
export type Attachment = {
  name: string;
  size: number;
};
export type Index = {
  notes: Note[];
  warnings: string[];
  diagnostics: Diagnostic[];
};
export type DeletedNote = {
  id: string;
  trash_entry: string;
};

export type NoteColumn = {
  key: number;
  document: Document;
  source: string;
  html: string;
  mode: "edit" | "view";
  external: boolean;
  editorZoom: number;
  viewZoom: number;
};
