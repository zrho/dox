import type { TitleSpan } from "../design/NoteTitle";
import type { SourceEditorRef } from "./sourceEditor";

export type Entry = { id: string; title: string; kind: string; date: string | null; links: string[]; revision: string; title_markup: string; title_spans?: TitleSpan[] };
export type Attachment = { name: string; size?: number };
export type Selection = { start: number; end: number };
export type Reading = {
  entry: Entry;
  html: string | null;
  source: string;
  revision: string;
  diagnostics: string[];
  attachments: Attachment[];
  warning?: string | null;
};
export type Pane = {
  key: number; id: string; note?: Reading; error?: string;
  editing?: boolean; draft?: string; saving?: boolean; updating?: boolean; external?: boolean; problem?: string;
  editorZoom?: number; previewZoom?: number;
  /** Increment when adopting replacement source, not on saves or mode changes. */
  editorGeneration?: number;
};

export const PANE_ZOOM_MIN = 50;
export const PANE_ZOOM_MAX = 250;
export const PANE_ZOOM_STEP = 10;
export const DEFAULT_PANE_ZOOM = { editor: 100, preview: 90 } as const;

export function getPaneZoom(pane: Pane | undefined, mode: keyof typeof DEFAULT_PANE_ZOOM): number {
  return (mode === "editor" ? pane?.editorZoom : pane?.previewZoom) ?? DEFAULT_PANE_ZOOM[mode];
}

export function paneZoomPatch(pane: Pane, change: number | "reset"): Pick<Pane, "editorZoom" | "previewZoom"> {
  const mode = pane.editing ? "editor" : "preview";
  const zoom = change === "reset"
    ? DEFAULT_PANE_ZOOM[mode]
    : Math.max(PANE_ZOOM_MIN, Math.min(PANE_ZOOM_MAX, getPaneZoom(pane, mode) + change));
  return mode === "editor" ? { editorZoom: zoom } : { previewZoom: zoom };
}

export type PaneActions = {
  busy: boolean;
  locked: boolean;
  onEditor: (key: number, editor: SourceEditorRef) => void;
  onSelection: (key: number, selection: Selection) => void;
  onAttach: (key: number) => void;
  onDropAttachments: (key: number, uris: string[]) => void;
  onOpenAttachment: (key: number, name: string) => void;
  onRemoveAttachment: (key: number, name: string) => void;
};

export function dirty(pane: Pane | undefined): boolean {
  return pane?.draft !== undefined && pane.draft !== pane.note?.source;
}
