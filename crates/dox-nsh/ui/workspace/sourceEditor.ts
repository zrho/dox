import type { EditorPosition } from "nsh/base";

export interface SourceEditorRef {
  focus(): void;
  /** Selects UTF-16 offsets in the pane source. Without `end`, places a caret. */
  setSelection(start: number, end?: number): void;
  /** Queues one native undo edit and puts the caret after the inserted text.
   * Returns false if the editor is unavailable or read-only. The edit reports through onDraft.
   */
  replaceRange(start: number, end: number, text: string): boolean;
}

// Editor normalizes line endings to LF. Pane offsets still count CRLF as two
// code units until the first native change.
export function sourcePosition(source: string, offset: number): EditorPosition {
  const target = Math.max(0, Math.min(offset, source.length));
  const breaks = /\r\n|\r|\n/g;
  let line = 0;
  let start = 0;
  for (let match = breaks.exec(source); match; match = breaks.exec(source)) {
    if (breaks.lastIndex > target) return { line, column: Math.min(target, match.index) - start };
    line++;
    start = breaks.lastIndex;
  }
  return { line, column: target - start };
}

export function sourceOffset(source: string, position: EditorPosition): number {
  const breaks = /\r\n|\r|\n/g;
  for (let line = 0; line < position.line; line++) {
    if (!breaks.exec(source)) return source.length;
  }
  const start = breaks.lastIndex;
  return Math.min(start + position.column, breaks.exec(source)?.index ?? source.length);
}
