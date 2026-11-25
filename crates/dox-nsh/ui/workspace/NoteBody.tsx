import { effect, Scroll, signal, Text, View } from "nsh";
import { NoteEditor } from "./NoteEditor";
import { NotePreview } from "./NotePreview";
import { DEFAULT_PANE_ZOOM, PANE_ZOOM_MAX, PANE_ZOOM_MIN, dirty, getPaneZoom, type Pane, type PaneActions } from "./paneState";

export function NoteBody(props: {
  pane: Pane;
  active: boolean;
  onActivate: () => void;
  onNavigate: (id: string) => void;
  getNoteTitle: (id: string) => string | undefined;
  onHorizontalScroll: (delta: number) => void;
  onDraft: (source: string) => void;
  onEditorFocus: (focused: boolean) => void;
  actions: PaneActions;
}) {
  const hasEdited = signal(false);
  effect(() => {
    if (props.pane.note && props.pane.editing) hasEdited.set(true);
  });
  // Document replacements get a fresh history; hiding the editor does not change its key.
  const editorSlots = () => props.pane.editing || hasEdited()
    ? [{ id: props.pane.id, generation: props.pane.editorGeneration ?? 0 }]
    : [];

  // Hide the preview without unmounting its native WebView.
  const html = () => props.pane.note?.html ?? null;
  const showPreview = () => html() !== null && !props.pane.editing;
  const previewZoom = () => {
    const zoom = getPaneZoom(props.pane, "preview");
    return Number.isFinite(zoom) ? Math.max(PANE_ZOOM_MIN, Math.min(PANE_ZOOM_MAX, Math.round(zoom))) : DEFAULT_PANE_ZOOM.preview;
  };

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
              <Each of={editorSlots()} key={(slot) => JSON.stringify([slot.id, slot.generation])}>
                {(_slot) => (
                  <NoteEditor pane={props.pane} active={props.active} actions={props.actions}
                    onEditorFocus={props.onEditorFocus} onDraft={props.onDraft} />
                )}
              </Each>
              <If when={!props.pane.editing && note().html === null}>
                <Scroll class="flex-1" onPressDown={props.onActivate}>
                  <View selectable><Text class="px-4 py-2 text-foreground" style={{ fontSize: 15 * previewZoom() / DEFAULT_PANE_ZOOM.preview }}>{note().source || "No preview available"}</Text></View>
                </Scroll>
              </If>
            </>
          )}
        </If>
      </If>
      <View class="min-h-0" style={!showPreview()
        ? { position: "absolute", top: 0, left: 0, width: 2, height: 2, opacity: 0, pointerEvents: "none" }
        : { flex: 1 }} importantForAccessibility={!showPreview() ? "no-hide-descendants" : "auto"}>
        <NotePreview html={html()} title={props.pane.note?.entry.title ?? props.pane.id} onActivate={props.onActivate} onNote={props.onNavigate}
          active={props.active && showPreview()} getNoteTitle={props.getNoteTitle} zoom={previewZoom()}
          onHorizontalScroll={props.onHorizontalScroll} />
      </View>
    </View>
  );
}
