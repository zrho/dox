import type { InputRef } from "nsh/types";

export type Entry = { id: string; title: string; kind: string; date: string | null; links: string[]; revision: string; title_markup: string };
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
};

export type PaneActions = {
  busy: boolean;
  locked: boolean;
  onEditor: (key: number, editor: InputRef) => void;
  onSelection: (key: number, selection: Selection) => void;
  onAttach: (key: number) => void;
  onDropAttachments: (key: number, uris: string[]) => void;
  onOpenAttachment: (key: number, name: string) => void;
  onRemoveAttachment: (key: number, name: string) => void;
};

export function dirty(pane: Pane | undefined): boolean {
  return pane?.draft !== undefined && pane.draft !== pane.note?.source;
}
