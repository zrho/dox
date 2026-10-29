import { invoke } from "@tauri-apps/api/core";
import { Show } from "solid-js";
import {
  bindingLabel,
  commandBinding,
  type CommandId,
  type UICommand,
} from "../../utils/commands";
import Kbd from "../ui/Kbd";
import FuzzyPicker, { MatchText, type FuzzyResult } from "../ui/FuzzyPicker";
import NoteTitle, { titleText, type TitledNote } from "./NoteTitle";
import NoteIcon from "./NoteIcon";

function findMatches(query: string, candidates: string[][]) {
  return invoke<FuzzyResult[]>("fuzzy_find", { query, candidates });
}

export function CommandPicker(props: {
  open: boolean;
  commands: UICommand[];
  onOpenChange: (open: boolean) => void;
  onSelect: (id: CommandId) => void;
}) {
  return (
    <FuzzyPicker
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Command panel"
      label="Find command"
      listLabel="Commands"
      placeholder="Find command…"
      shortcut={commandBinding("commands")}
      emptyText="No commands found"
      items={props.commands}
      searchTexts={(command) => [command.title]}
      findMatches={findMatches}
      disabled={(command) => !command.enabled}
      dimDisabled
      selectAfterClose
      onSelect={(command) => props.onSelect(command.id)}
      renderItem={(command, matches) => (
        <>
          <span class="min-w-0 flex-1 truncate">
            <MatchText
              text={command.title}
              positions={matches[0]?.positions ?? []}
            />
          </span>
          <Show when={command.binding}>
            <Kbd>{bindingLabel(command.binding)}</Kbd>
          </Show>
        </>
      )}
    />
  );
}

type PickerNote = TitledNote & {
  id: string;
  metadata: {
    type: string;
  };
};
type NotePickerProps = {
  open: boolean;
  mode?: "open" | "insert";
  onCloseAutoFocus?: (event: Event) => void;
  notes: PickerNote[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
};
export function NotePicker(props: NotePickerProps) {
  return (
    <FuzzyPicker
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.mode === "insert" ? "Insert link or citation" : "Find note"}
      listLabel="Notes"
      placeholder={props.mode === "insert" ? "Link or cite…" : "Find note…"}
      shortcut={commandBinding(props.mode === "insert" ? "insert" : "find")}
      items={props.notes}
      busy={props.busy}
      searchTexts={(note) => [titleText(note), note.title, note.id]}
      findMatches={findMatches}
      onSelect={(note) => props.onSelect(note.id)}
      onCloseAutoFocus={props.onCloseAutoFocus}
      renderItem={(note, matches) => (
        <>
          <NoteIcon
            type={note.metadata.type}
            class="size-3 shrink-0 text-muted"
          />
          <span class="min-w-0 flex-1 truncate">
            <NoteTitle note={note} positions={matches[0]?.positions ?? []} />
          </span>
          <span class="shrink-0 font-mono text-[10px] text-muted">
            <MatchText text={note.id} positions={matches[2]?.positions ?? []} />
          </span>
        </>
      )}
    />
  );
}
