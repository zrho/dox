import { Scroll, Text, View } from "nsh";
import { NoteEditor } from "./NoteEditor";
import { NotePreview } from "./NotePreview";
import { dirty, type Pane, type PaneActions } from "./paneState";

export function NoteBody(props: {
  pane: Pane;
  active: boolean;
  onActivate: () => void;
  onNavigate: (id: string) => void;
  onHorizontalScroll: (delta: number) => void;
  onDraft: (source: string) => void;
  onEditorFocus: (focused: boolean) => void;
  actions: PaneActions;
}) {
  // Hide the preview without unmounting its native WebView.
  const html = () => props.pane.note?.html ?? null;
  const showPreview = () => html() !== null && !props.pane.editing;

  return (
    <View class="min-h-0 flex-1">
      <If when={props.pane.external || props.pane.problem}>
        <View class="shrink-0 gap-1 border-b border-border px-3 py-2">
          <If when={props.pane.external}>
            <Text class="text-xs text-muted-foreground">{dirty(props.pane) ? "This note changed on disk. Your draft is preserved." : "This note changed on disk."}</Text>
          </If>
          <If when={props.pane.problem}><Text class="text-xs text-foreground">{props.pane.problem}</Text></If>
        </View>
      </If>
      <If when={props.pane.id !== ""}>
        <If when={props.pane.note} else={
          <Text class="px-4 py-2 text-sm text-muted-foreground">{props.pane.error || "Loading note…"}</Text>
        }>
          {(note) => (
            <>
              <If when={note().diagnostics.length > 0}>
                <Scroll style={{ maxHeight: 88 }} class="shrink-0 border-b border-border">
                  <View selectable><Text class="px-4 py-2 text-xs text-foreground">{note().diagnostics.join("\n")}</Text></View>
                </Scroll>
              </If>
              <If when={props.pane.editing} else={
                <If when={note().html === null}>
                  <Scroll class="flex-1" onPressDown={props.onActivate}>
                    <View selectable><Text class="px-4 py-2 text-foreground">{note().source || "No preview available"}</Text></View>
                  </Scroll>
                </If>
              }>
                <NoteEditor pane={props.pane} active={props.active} actions={props.actions}
                  onEditorFocus={props.onEditorFocus} onDraft={props.onDraft} />
              </If>
            </>
          )}
        </If>
      </If>
      <View class="min-h-0" style={!showPreview()
        ? { position: "absolute", top: 0, left: 0, width: 2, height: 2, opacity: 0, pointerEvents: "none" }
        : { flex: 1 }} importantForAccessibility={!showPreview() ? "no-hide-descendants" : "auto"}>
        <NotePreview html={html()} title={props.pane.note?.entry.title ?? props.pane.id} onActivate={props.onActivate} onNote={props.onNavigate}
          onHorizontalScroll={props.onHorizontalScroll} />
      </View>
    </View>
  );
}
