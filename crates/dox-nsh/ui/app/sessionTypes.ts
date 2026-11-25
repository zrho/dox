import type { Entry } from "../workspace/paneState";

export type Issue = {
  id: string;
  severity: "error" | "warning" | "proposal";
  message: string;
  note_id: string | null;
  document: string | null;
  line: number | null;
  column: number | null;
  target_note_id: string | null;
};
export type Index = { entries: Entry[]; diagnostics: Issue[] };
export type Opened = { path: string; index: Index; watch_error: string | null };
export type GitSummary = { branch: string | null; upstream: string | null; changed: number; ahead: number | null; behind: number | null };

export function canOpenDiagnostic(issue: Issue, entries: readonly Entry[]): boolean {
  return !!issue.note_id && entries.some((entry) => entry.id === issue.note_id);
}

function validCoordinate(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}

export function diagnosticPosition(source: string, entry: Entry, issue: Issue, libraryPath: string): number {
  if (entry.id !== issue.note_id) return 0;
  const document = "document" in entry && typeof entry.document === "string" ? entry.document : "";
  const relative = `notes/${entry.id}/${document}`;
  const absolute = `${libraryPath.replace(/\/+$/, "")}/${relative}`;
  const ownDocument = document && (issue.document === document || issue.document === relative ||
    (!!libraryPath && issue.document === absolute));

  if (ownDocument && validCoordinate(issue.line)) {
    let start = 0;
    let end = source.indexOf("\n");
    for (let line = 1; line < issue.line && end !== -1; line++) {
      start = end + 1;
      end = source.indexOf("\n", start);
    }
    if (end === -1) end = source.length;
    else if (source[end - 1] === "\r") end--;

    // The core counts Unicode code points. NSH selection offsets count UTF-16 units.
    let position = start;
    const column = validCoordinate(issue.column) ? issue.column : 1;
    for (let index = 1; index < column && position < end; index++) {
      position += source.codePointAt(position)! > 0xffff ? 2 : 1;
    }
    return position;
  }

  return issue.target_note_id ? Math.max(0, source.indexOf(`dox:${issue.target_note_id}`)) : 0;
}
