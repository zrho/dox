import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import ArrowDownToLine from "lucide-solid/icons/arrow-down-to-line";
import ArrowUpFromLine from "lucide-solid/icons/arrow-up-from-line";
import FileText from "lucide-solid/icons/file-text";
import SaveAll from "lucide-solid/icons/save-all";
import GitCommitHorizontal from "lucide-solid/icons/git-commit-horizontal";
import CloudUpload from "lucide-solid/icons/cloud-upload";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Button from "../ui/Button";
import { titleText } from "./NoteTitle";
import type { LibrarySession } from "../../hooks/createLibrarySession";
import type { GitChange, GitDiff } from "../../types";

type Group = { key: string; title: string; noteId?: string; files: (GitChange & { key: string })[] };
function sizeLabel(size: number | null) {
  if (size === null) return "";
  return size < 1024 ? `${size} bytes` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
/** Review and commit saved library files without staging controls or a merge UI. */
export default function GitChangesPaneContent(props: { app: LibrarySession }) {
  const app = props.app;
  const git = app.git;
  const state = git.snapshot;
  const status = () => state()?.status;
  const stamp = createMemo(() => status()?.fingerprint ?? "");
  const [groups, setGroups] = createStore<Group[]>([]);
  createEffect(() => {
    const notes = new Map(app.index().notes.map((note) => [note.id, note]));
    const grouped = new Map<string, Group>();
    for (const change of status()?.changes ?? []) {
      const parts = change.path.split("/");
      const id = parts[0] === "notes" && parts.length > 2 ? parts[1] : "";
      const note = notes.get(id);
      const isNote = note || /^(?:[A-Z0-9]{5}|\d{4}-\d{2}-\d{2})$/.test(id);
      const key = isNote ? id : "other-files";
      let group = grouped.get(key);
      if (!group) {
        group = { key, title: note ? titleText(note) : isNote ? id : "Other library files", noteId: note?.id, files: [] };
        grouped.set(key, group);
      }
      group.files.push({ ...change, key: change.path });
    }
    setGroups(reconcile([...grouped.values()], { key: "key" }));
  });
  const checked = () => state()?.checked_at ? new Date(state()!.checked_at! * 1000).toLocaleString() : "Not checked yet";
  return (
    <div class="flex min-h-0 flex-1 flex-col bg-document-background text-document-foreground" aria-busy={git.operation()}>
      <header class="shrink-0 px-3 py-2">
        <div class="flex items-center justify-between gap-2">
          <h2 class="m-0 text-sm font-medium">Library changes</h2>
          <Show when={status()?.available}>
            <div class="flex shrink-0 items-center gap-1">
              <Button size="icon" variant="ghost" aria-label="Check for updates" tooltip={`Check for updates · Last checked: ${checked()}${git.operation() ? " · Git operation in progress" : ""}`} busy={git.operation()} onClick={() => void git.act("fetch")}><RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" /></Button>
              <Button size="icon" variant="ghost" aria-label="Pull updates" busy={git.operation()} disabled={!git.canPull()} onClick={() => void git.act("pull")}><ArrowDownToLine size={16} strokeWidth={1.5} aria-hidden="true" /></Button>
              <Button size="icon" variant="ghost" aria-label="Push" busy={git.operation()} disabled={!git.canPush()} onClick={() => void git.act("push")}><ArrowUpFromLine size={16} strokeWidth={1.5} aria-hidden="true" /></Button>
            </div>
          </Show>
        </div>
        <p class="mt-1 text-[11px] text-muted">{status()?.available ? git.statusLabel() : "Git"}</p>
      </header>
      <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-xs">
        <Show when={state()} fallback={<p class="text-muted">Reading repository status…</p>}>
          <Show when={status()?.available} fallback={
            <div>
              <p class="whitespace-pre-wrap">{status()?.reason ?? "Git is unavailable."}</p>
              <Button size="icon" variant="ghost" aria-label="Check again" onClick={() => void git.refresh(true)}><RefreshCw size={16} strokeWidth={1.5} aria-hidden="true" /></Button>
            </div>
          }>
            <Show when={state()?.remote_error || status()?.blocked || ((status()?.ahead ?? 0) > 0 && (status()?.behind ?? 0) > 0)}>
              <div class="mb-3 space-y-1 pb-2">
                <Show when={state()?.remote_error}><p class="whitespace-pre-wrap text-warning">Remote check failed: {state()?.remote_error}</p></Show>
                <Show when={status()?.blocked}><p class="whitespace-pre-wrap text-warning">{status()?.blocked}</p></Show>
                <Show when={(status()?.ahead ?? 0) > 0 && (status()?.behind ?? 0) > 0}>
                  <p class="text-warning">Local and remote changes have diverged. Resolve them in an external Git tool.</p>
                </Show>
              </div>
            </Show>
            <Show when={status()?.changes.length} fallback={<p class="py-2 text-muted">No saved file changes.</p>}>
              <For each={groups}>
                {(group) => (
                  <section class="mb-3" aria-label={group.title}>
                    <header class="mb-1 flex items-center gap-2">
                      <h3 class="min-w-0 flex-1 truncate text-xs font-medium" title={group.title}>{group.title}</h3>
                      <Show when={group.noteId}>
                        <Button size="icon" variant="ghost" aria-label="Open note" busy={app.busy()} onClick={() => app.openWorkspaceNote(group.noteId!)}><FileText size={16} strokeWidth={1.5} aria-hidden="true" /></Button>
                      </Show>
                    </header>
                    <For each={group.files}>
                      {(change) => <ChangeRow change={change} app={app} stamp={stamp()} />}
                    </For>
                  </section>
                )}
              </For>
            </Show>
            <section class="mt-3 space-y-2 pt-3" aria-label="Commit library changes">
              <Show when={git.hasDrafts()}>
                <div class="text-warning">
                  <p>Save all drafts before committing or pulling.</p>
                  <For each={git.drafts()}>{(drafts) => <p class="mt-1">{drafts.window === git.label ? "This window" : drafts.window}: {drafts.titles.join(", ")}</p>}</For>
                  <Button size="icon" variant="ghost" aria-label="Save all drafts in this window" busy={app.busy()} disabled={!app.hasDrafts()} onClick={app.saveAllDrafts}><SaveAll size={16} strokeWidth={1.5} aria-hidden="true" /></Button>
                </div>
              </Show>
              <Show when={status()?.staged && !status()?.retry_commit}>
                <p class="text-warning">Changes were staged externally. Finish or clear that staging externally before committing in dox.</p>
              </Show>
              <Show when={status()?.retry_commit}>
                <p class="text-muted">The previous commit did not finish. Its staged files are preserved; you can retry.</p>
              </Show>
              <label class="block" for="git-commit-message">Commit message</label>
              <textarea
                id="git-commit-message"
                class="block min-h-20 w-full resize-y rounded border border-border bg-document-background px-2 py-1 text-xs outline-none focus:border-accent disabled:opacity-50"
                value={git.message()}
                readOnly={git.operation()}
                onInput={(event) => git.setMessage(event.currentTarget.value)}
              />
              <div class="flex flex-wrap justify-end gap-1">
                <Button size="icon" variant="ghost" aria-label="Commit locally" busy={git.operation()} disabled={!git.canCommit()} onClick={() => void git.act("commit")}><GitCommitHorizontal size={16} strokeWidth={1.5} aria-hidden="true" /></Button>
                <Button size="icon" variant="ghost" aria-label="Commit and push" busy={git.operation()} disabled={!git.canCommit() || !status()?.upstream} onClick={() => void git.act("commit-push")}><CloudUpload size={16} strokeWidth={1.5} aria-hidden="true" /></Button>
              </div>
            </section>
          </Show>
        </Show>
        <Show when={git.error()}><p role="alert" class="mt-3 whitespace-pre-wrap text-warning">{git.error()}</p></Show>
        <Show when={state()?.result}>
          <p role="status" class="mt-3 whitespace-pre-wrap" classList={{ "text-warning": !state()?.result?.success, "text-muted": !!state()?.result?.success }}>{state()?.result?.message}</p>
        </Show>
      </div>
    </div>
  );
}
function ChangeRow(props: { change: GitChange; app: LibrarySession; stamp: string }) {
  const [expanded, setExpanded] = createSignal(false);
  const [diff, setDiff] = createSignal<GitDiff>();
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  let request = 0;
  let loadedKey: string | undefined;
  const diffKey = createMemo(() => JSON.stringify([props.app.library(), props.change.path, props.stamp]));
  createEffect(() => {
    if (!expanded() || props.app.git.operation()) return;
    const key = diffKey();
    if (key === loadedKey) return;
    const path = props.change.path;
    const token = ++request;
    setLoading(true); setError("");
    void props.app.git.diff(path).then((value) => {
      if (token === request) { loadedKey = key; setDiff(value); }
    }).catch((e) => { if (token === request) setError(String(e)); })
      .finally(() => { if (token === request) setLoading(false); });
    onCleanup(() => { request++; });
  });
  return (
    <div>
      <button type="button" class="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-hover" aria-expanded={expanded()} onClick={() => setExpanded(!expanded())}>
        <span class="shrink-0 text-muted"><Show when={expanded()} fallback={<ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />}><ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" /></Show></span>
        <span class="shrink-0 text-[10px] text-muted">{props.change.status}</span>
        <span class="min-w-0 flex-1 break-all font-mono text-[11px]">{props.change.path}</span>
        <span class="shrink-0 text-[10px] text-muted">{sizeLabel(props.change.size)}</span>
      </button>
      <Show when={expanded()}>
        <Show when={loading() && !diff()}><p class="py-1 text-muted">Reading diff…</p></Show>
        <Show when={error()}><p class="whitespace-pre-wrap py-1 text-warning">{error()}</p></Show>
        <Show when={!error() && diff()}>
          {(value) => (
            <div class="mb-2">
              <Show when={!value().binary} fallback={<p class="py-2 text-muted">Binary file or symbolic link · {sizeLabel(value().size)}</p>}>
                <pre class="m-0 max-h-96 overflow-auto bg-document-background p-3 font-editor text-[13px] leading-[1.5]">{value().text || "No text diff available."}</pre>
              </Show>
              <Show when={value().truncated}><p class="py-1 text-warning">Diff truncated at 1 MiB.</p></Show>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}
