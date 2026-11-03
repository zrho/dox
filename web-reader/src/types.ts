// Public static export contract, independent of desktop document/session types.
export type Snapshot = {
  schema_version: number;
  snapshot: string;
  title: string;
  created_at: string;
  library_url: string;
};
export type Entry = { id: string; title: string; title_html: string | null; kind: string; tags: string[]; links: string[] };
export type Library = { schema_version: number; title: string; created_at: string; notes: Entry[] };
export type Attachment = { name: string; size: number; url: string; hash: string };
export type Note = Entry & { html: string; title_html: string | null; date: string | null; attachments: Attachment[] };
