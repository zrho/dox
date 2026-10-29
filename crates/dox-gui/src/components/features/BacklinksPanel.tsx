import { For, Show } from "solid-js";
import InfoPanel from "../ui/InfoPanel";
import Button from "../ui/Button";
import NoteTitle, { titleText } from "./NoteTitle";
import NoteIcon from "./NoteIcon";
import type { Note } from "../../types";
export default function BacklinksPanel(props: {
  notes: Note[];
  busy: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <Show when={props.notes.length}>
      <InfoPanel
        title="BACKLINKS"
        count={props.notes.length}
        bodyClass="max-h-[102px]"
      >
        <For each={props.notes}>
          {(note) => (
            <Button
              variant="ghost"
              size="row"
              busy={props.busy}
              class="w-full gap-3 text-[11px]"
              onClick={() => props.onOpen(note.id)}
            >
              <NoteIcon
                type={note.metadata.type}
                class="size-3 shrink-0 text-muted"
              />
              <span class="min-w-0 truncate" title={titleText(note)}>
                <NoteTitle note={note} />
              </span>
              <span class="shrink-0 font-mono text-[10px] text-muted">
                {note.id}
              </span>
            </Button>
          )}
        </For>
      </InfoPanel>
    </Show>
  );
}
