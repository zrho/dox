import { effect, signal, Text, View } from "nsh";
import type { ViewRef } from "nsh/types";
import { AttachmentsDrawer } from "./AttachmentsDrawer";
import { BacklinksDrawer } from "./BacklinksDrawer";
import { NoteBody } from "./NoteBody";
import { NoteFooter } from "./NoteFooter";
import type { Entry, Pane, PaneActions } from "./paneState";

export function NotePane(props: {
  pane: Pane;
  width: number;
  active: boolean;
  first: boolean;
  reveal: number;
  entries: readonly Entry[];
  onActivate: () => void;
  onNavigate: (id: string) => void;
  onHorizontalScroll: (delta: number) => void;
  onEdit: () => void;
  onDraft: (source: string) => void;
  onEditorFocus: (focused: boolean) => void;
  actions: PaneActions;
}) {
  const frame = signal<ViewRef>();
  const idle = () => props.pane.id === "";
  const draggingFiles = signal(false);
  const acceptsDrop = () => !!props.pane.note && !props.actions.busy;

  effect(() => {
    if (!props.active) return;
    // Also reveal an already active pane when the picker selects it again or it moves.
    void props.reveal;
    void props.width;
    frame()?.reveal({ horizontal: "nearest", animated: false });
  });

  return (
    <View
      ref={(node) => frame.set(node)}
      style={idle() ? { position: "absolute", left: 0, top: 0, width: 2, height: 2, opacity: 0, pointerEvents: "none" } : { width: props.width }}
      class={`h-full shrink-0 border-r border-border bg-background${props.first ? " border-l" : ""}`}
      onFileDragEnter={acceptsDrop() ? () => draggingFiles.set(true) : undefined}
      onFileDragLeave={() => draggingFiles.set(false)}
      onFileDrop={acceptsDrop() ? ({ uris }) => {
        draggingFiles.set(false);
        props.onActivate();
        props.actions.onDropAttachments(props.pane.key, uris);
      } : undefined}
      importantForAccessibility={idle() ? "no-hide-descendants" : "auto"}
      accessibilityLabel={props.pane.note?.entry.title ?? props.pane.id}
    >
      <View style={{ height: 2 }} class={props.active || (acceptsDrop() && draggingFiles()) ? "bg-primary" : "bg-transparent"} />
      <If when={acceptsDrop() && draggingFiles()}>
        <Text class="bg-muted px-2 py-1 text-xs text-foreground">Drop files to attach</Text>
      </If>
      <View style={{ height: 8 }} onPress={props.onActivate} class="shrink-0" />
      <NoteBody pane={props.pane} active={props.active} onActivate={props.onActivate} onNavigate={props.onNavigate}
        onHorizontalScroll={props.onHorizontalScroll} onDraft={props.onDraft} onEditorFocus={props.onEditorFocus}
        actions={props.actions} />
      <BacklinksDrawer entries={props.entries} id={props.pane.id} onActivate={props.onActivate} onNavigate={props.onNavigate} />
      <AttachmentsDrawer files={props.pane.note?.attachments ?? []} busy={props.actions.busy}
        onAdd={() => props.actions.onAttach(props.pane.key)}
        onOpen={(name) => props.actions.onOpenAttachment(props.pane.key, name)}
        onRemove={(name) => props.actions.onRemoveAttachment(props.pane.key, name)} />
      <NoteFooter pane={props.pane} onActivate={props.onActivate} onEdit={props.onEdit} />
    </View>
  );
}
