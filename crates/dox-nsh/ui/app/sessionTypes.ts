import type { Entry } from "../workspace/paneState";

export type Issue = { id: string; severity: "error" | "warning" | "proposal"; message: string; note_id: string | null };
export type Index = { entries: Entry[]; diagnostics: Issue[] };
export type Opened = { path: string; index: Index; watch_error: string | null };
export type GitSummary = { branch: string | null; upstream: string | null; changed: number; ahead: number | null; behind: number | null };
