import { Text, View } from "nsh";
import { IconButton } from "../design/IconButton";
import { dirty, type Pane } from "./paneState";

export function NoteFooter(props: {
  pane: Pane;
  onActivate: () => void;
  onEdit: () => void;
}) {
  return (
    <View
      style={{ height: 22 }}
      class="shrink-0 flex-row items-center justify-between border-t border-border bg-muted px-2"
      onPress={props.onActivate}
      accessibilityLabel="Item metadata"
    >
      <View class="flex-row items-center gap-2">
        <Text class="text-xs text-muted-foreground">{props.pane.note?.entry.date ?? ""}</Text>
        <If when={props.pane.saving || dirty(props.pane)}>
          <Text class="text-xs text-muted-foreground">{props.pane.saving ? "Saving…" : "● Unsaved"}</Text>
        </If>
      </View>
      <View class="flex-row items-center gap-2">
        <If when={props.pane.note}>
          <IconButton icon={props.pane.editing ? "view" : "edit"}
            label={props.pane.editing ? "Save and view note" : "Edit source"}
            disabled={props.pane.saving || props.pane.updating} onPress={props.onEdit} />
        </If>
        <Text class="font-mono text-xs text-muted-foreground">{props.pane.id}</Text>
      </View>
    </View>
  );
}
