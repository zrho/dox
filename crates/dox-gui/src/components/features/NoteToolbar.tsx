import Pin from "lucide-solid/icons/pin";
import PinOff from "lucide-solid/icons/pin-off";
import { Show } from "solid-js";
import Pencil from "lucide-solid/icons/pencil";
import Eye from "lucide-solid/icons/eye";
import Save from "lucide-solid/icons/save";
import Trash from "lucide-solid/icons/trash";
import Paperclip from "lucide-solid/icons/paperclip";
import Button from "../ui/Button";
import { commandBinding, type CommandId } from "../../utils/commands";
import type { Note } from "../../types";
export default function NoteToolbar(props: {
  titlebar?: boolean;
  note?: Note;
  mode: "edit" | "view";
  dirty: boolean;
  busy: boolean;
  onCommand: (id: CommandId) => void;
}) {
  return (
    <header
      data-tauri-drag-region={props.titlebar ? "" : undefined}
      class="flex shrink-0 items-center justify-end border-b border-border bg-chrome px-[10px]"
      classList={{
        "h-10": props.titlebar,
        "pl-[88px]": props.titlebar,
        "select-none": props.titlebar,
        "h-7": !props.titlebar,
      }}
    >
      <Show when={props.note}>
        <div
          data-tauri-drag-region={props.titlebar ? "" : undefined}
          class="flex items-center gap-1"
        >
          <Button
            size="icon"
            aria-label="Attach files"
            busy={props.busy}
            onClick={() => props.onCommand("attach-files")}
          >
            <Paperclip size={14} strokeWidth={1.5} aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            selected={props.note?.metadata.pinned === true}
            aria-label={
              props.note?.metadata.pinned === true ? "Unpin item" : "Pin item"
            }
            busy={props.busy}
            onClick={() => props.onCommand("toggle-pin")}
          >
            <Show
              when={props.note?.metadata.pinned === true}
              fallback={<Pin size={14} strokeWidth={1.5} aria-hidden="true" />}
            >
              <PinOff size={14} strokeWidth={1.5} aria-hidden="true" />
            </Show>
          </Button>
          <Button
            size="icon"
            busy={props.busy}
            aria-label={props.mode === "view" ? "Edit source" : "View note"}
            tooltip={`${props.mode === "view" ? "Edit source" : "View note"} (${commandBinding("toggle-mode")})`}
            onClick={() => props.onCommand("toggle-mode")}
          >
            <Show
              when={props.mode === "view"}
              fallback={<Eye size={14} strokeWidth={1.5} aria-hidden="true" />}
            >
              <Pencil size={14} strokeWidth={1.5} aria-hidden="true" />
            </Show>
          </Button>
          <Button
            size="icon"
            aria-label="Save note"
            tooltip={`Save note (${commandBinding("save")})`}
            disabled={!props.dirty}
            busy={props.busy}
            onClick={() => props.onCommand("save")}
          >
            <Save size={14} strokeWidth={1.5} aria-hidden="true" />
          </Button>
          <Button
            size="icon"
            aria-label="Delete note"
            variant="danger"
            busy={props.busy}
            onClick={() => props.onCommand("delete")}
          >
            <Trash size={14} strokeWidth={1.5} aria-hidden="true" />
          </Button>
        </div>
      </Show>
    </header>
  );
}
