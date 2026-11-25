import { Input } from "nsh/base";
import type { Pane, PaneActions } from "./paneState";

export function NoteEditor(props: {
  pane: Pane;
  active: boolean;
  onDraft: (source: string) => void;
  onEditorFocus: (focused: boolean) => void;
  actions: PaneActions;
}) {
  const source = () => props.pane.draft ?? props.pane.note?.source ?? "";

  return (
    <Input
      ref={(editor) => props.actions.onEditor(props.pane.key, editor)}
      multiline autoFocus={props.active} autoCapitalize="none" autoCorrect={false} readonly={props.actions.locked}
      onSelectionChange={(range) => props.actions.onSelection(props.pane.key, range)}
      class="min-h-0 flex-1 px-4 py-2 font-mono text-sm text-foreground"
      accessibilityLabel="Note source" value={source()}
      onFocus={() => props.onEditorFocus(true)} onBlur={() => props.onEditorFocus(false)}
      onChange={({ value }) => props.onDraft(value)}
    />
  );
}
