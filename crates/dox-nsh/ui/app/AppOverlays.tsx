import { computed } from "nsh";
import { Picker, type PickerItem } from "../overlays/Picker";
import { PublicationDialog } from "../overlays/PublicationDialog";
import type { Session } from "./createSession";

type OverlayState = Pick<Session, "index" | "overlay" | "openNote" | "insertLink" | "closeLinkPicker" | "importPublication">;

export function AppOverlays(props: { state: OverlayState; commands: readonly PickerItem[]; onCommand: (id: string) => void }) {
  const { index, overlay, openNote, insertLink, closeLinkPicker, importPublication } = props.state;
  const noteItems = computed<PickerItem[]>(() => index().entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    detail: entry.id,
    icon: entry.kind === "literature" ? "reference" : "note",
  })));
  return (
    <>
      <If when={overlay() === "commands"}>
        <Picker title="Command panel" searchIcon="command" placeholder="Find command…" items={props.commands} onSelect={props.onCommand} onClose={() => overlay.set(null)} />
      </If>
      <If when={overlay() === "notes"}>
        <Picker title="Find note" searchIcon="search" placeholder="Find note…" items={noteItems()} onSelect={(id) => { overlay.set(null); void openNote(id); }} onClose={() => overlay.set(null)} />
      </If>
      <If when={overlay() === "link"}>
        <Picker title="Insert link or citation" placeholder="Link or cite…" items={noteItems()} onSelect={insertLink} onClose={closeLinkPicker} />
      </If>
      <If when={overlay() === "publication"}>
        <PublicationDialog onImport={importPublication} onClose={() => overlay.set(null)} />
      </If>
    </>
  );
}
