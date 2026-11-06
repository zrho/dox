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
export type PublicationImport = {
  document: Document;
  warnings: string[];
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

/** Shared identity; content state belongs to each tagged pane variant. */
export type WorkspacePaneBase = {
  key: number;
  kind: string;
};
export type NotePane = WorkspacePaneBase & {
  kind: "note";
  document: Document;
  source: string;
  html: string;
  mode: "edit" | "view";
  external: boolean;
  editorZoom: number;
  viewZoom: number;
};

// Add new content variants here as the workspace gains other views.
export type GitChangesPane = WorkspacePaneBase & {
  kind: "git-changes";
};
export type WorkspacePane = NotePane | GitChangesPane;
export function isNotePane(pane: WorkspacePane): pane is NotePane {
  return pane.kind === "note";
}

export type GitChange = {
  path: string;
  status: "added" | "modified" | "deleted" | "conflict";
  staged: boolean;
  size: number | null;
};
export type GitStatus = {
  available: boolean;
  fingerprint: string;
  reason: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  changes: GitChange[];
  staged: boolean;
  conflicts: boolean;
  blocked: string | null;
  retry_commit: boolean;
};
export type GitAction = "fetch" | "commit" | "commit-push" | "pull" | "push";
export type GitSnapshot = {
  root: string;
  revision: number;
  status: GitStatus;
  operation: GitAction | null;
  checked_at: number | null;
  remote_error: string | null;
  drafts: { window: string; titles: string[] }[];
  result: { action: GitAction; success: boolean; commit: string | null; message: string } | null;
};
export type GitDiff = {
  text: string;
  binary: boolean;
  truncated: boolean;
  size: number | null;
};
