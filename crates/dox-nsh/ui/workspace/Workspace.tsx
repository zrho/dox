import { computed, Image, Scroll, signal, View } from "nsh";
import type { ScrollRef } from "nsh/types";
import sprig from "../assets/sprig.svg";
import { NotePane } from "./NotePane";
import type { Entry, Pane, PaneActions } from "./paneState";

export function Workspace(props: {
  panes: readonly Pane[];
  spareKey: number;
  activeKey: number | null;
  reveal: number;
  entries: readonly Entry[];
  onActivate: (key: number) => void;
  onNavigate: (id: string) => void;
  onEdit: (key: number) => void;
  onDraft: (key: number, source: string) => void;
  onReorder: (key: number, offset: number) => void;
  onEditorFocus: (key: number, focused: boolean) => void;
  actions: PaneActions;
}) {
  const viewport = signal({ width: 520, height: 0 });
  // App promotes this key to a real pane and reserves the next key in one batch.
  // Each retains the mounted subtree for that key, including the native WebView.
  const slots = computed<Pane[]>(() => [...props.panes, { key: props.spareKey, id: "" }]);
  const paneWidth = () => Math.min(520, Math.max(280, viewport().width));
  let strip: ScrollRef | undefined;
  let offsetX = 0;

  function scrollHorizontally(delta: number) {
    const limit = Math.max(0, props.panes.length * paneWidth() - viewport().width);
    const x = Math.min(limit, Math.max(0, offsetX + delta));
    if (x === offsetX) return;
    offsetX = x;
    strip?.scrollTo({ x, animated: false });
  }

  return (
    <View class="min-h-0 flex-1 bg-muted" onLayout={({ bounds }) => viewport.set(bounds.size)}>
      <If when={props.activeKey === null}>
        <View class="absolute inset-0 items-center justify-center" style={{ pointerEvents: "none" }}>
          <Image src={sprig} style={{ width: 96, height: 152, opacity: 0.25 }} accessible={false} />
        </View>
      </If>
      <Scroll horizontal scrollbar={false} class="flex-1"
        ref={(node) => { strip = node; }}
        onScroll={({ offset }) => { offsetX = offset.x; }}>
        <View
          style={{ width: Math.max(viewport().width, props.panes.length * paneWidth()), height: viewport().height }}
          class="flex-row justify-center"
          accessibilityLabel="Workspace panes"
        >
          <Each of={slots()} key={(pane) => pane.key}>
            {(pane) => (
              <NotePane
                pane={pane()}
                width={paneWidth()}
                active={props.activeKey === pane().key}
                first={props.panes[0]?.key === pane().key}
                reveal={props.reveal}
                entries={props.entries}
                onActivate={() => props.onActivate(pane().key)}
                onNavigate={props.onNavigate}
                onHorizontalScroll={scrollHorizontally}
                onDragReorder={(delta) => props.onReorder(pane().key, Math.sign(delta) * Math.round(Math.abs(delta) / paneWidth()))}
                onEdit={() => { props.onActivate(pane().key); props.onEdit(pane().key); }}
                onDraft={(source) => props.onDraft(pane().key, source)}
                onEditorFocus={(focused) => props.onEditorFocus(pane().key, focused)}
                actions={props.actions}
              />
            )}
          </Each>
        </View>
      </Scroll>
    </View>
  );
}
