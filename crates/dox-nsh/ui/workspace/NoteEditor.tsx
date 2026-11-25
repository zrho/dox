import { cleanup, computed, effect, signal, untracked, View } from "nsh";
import { Editor, type EditorRef, type EditorSelection } from "nsh/base";
import { getPaneZoom, type Pane, type PaneActions } from "./paneState";
import { sourceOffset, sourcePosition, type SourceEditorRef } from "./sourceEditor";

const EDITOR_FONT_SIZE = 13;

export function NoteEditor(props: {
  pane: Pane;
  active: boolean;
  onDraft: (source: string) => void;
  onEditorFocus: (focused: boolean) => void;
  actions: PaneActions;
}) {
  const key = untracked(() => props.pane.key);
  const initialSource = untracked(() => props.pane.draft ?? props.pane.note?.source ?? "");
  const visible = computed(() => !!props.pane.editing);
  const zoom = () => getPaneZoom(props.pane, "editor") / 100;
  const editor = signal<EditorRef>();
  let source = initialSource;
  let selection: EditorSelection | undefined;
  let selectionQueued = false;
  let focused = false;
  let disposed = false;

  function updateFocus(next: boolean) {
    if (focused === next) return;
    focused = next;
    props.onEditorFocus(next);
  }

  function reportSelection() {
    if (selectionQueued || !selection) return;
    selectionQueued = true;
    queueMicrotask(() => {
      selectionQueued = false;
      if (disposed || !visible() || !selection) return;
      const anchor = sourceOffset(source, selection.anchor);
      const head = sourceOffset(source, selection.head);
      props.actions.onSelection(key, { start: Math.min(anchor, head), end: Math.max(anchor, head) });
    });
  }

  const adapter: SourceEditorRef = {
    focus() { if (!disposed && visible()) editor()?.focus(); },
    setSelection(start, end = start) {
      if (disposed || !visible()) return;
      editor()?.setSelections([{ anchor: sourcePosition(source, start), head: sourcePosition(source, end) }]);
    },
    replaceRange(start, end, text) {
      const native = editor();
      if (!native || disposed || !visible() || props.actions.locked) return false;
      const range = { start: sourcePosition(source, Math.min(start, end)), end: sourcePosition(source, Math.max(start, end)) };
      const inserted = sourcePosition(text, text.length);
      const caret = {
        line: range.start.line + inserted.line,
        column: inserted.line === 0 ? range.start.column + inserted.column : inserted.column,
      };
      native.edit([{ range, text }]);
      native.setSelections([{ anchor: caret, head: caret }]);
      return true;
    },
  };

  effect(() => {
    const native = editor();
    const showing = visible();
    if (!native) return;
    untracked(() => {
      if (showing) {
        props.actions.onEditor(key, adapter);
        if (props.active) native.focus();
        reportSelection();
      } else if (focused) {
        native.blur();
        updateFocus(false);
      }
    });
  });

  cleanup(() => {
    disposed = true;
    updateFocus(false);
  });

  return (
    <View class="min-h-0 flex-1" style={{ display: visible() ? "flex" : "none" }}
      importantForAccessibility={visible() ? "auto" : "no-hide-descendants"}>
      <Editor ref={(native) => editor.set(native)} defaultValue={initialSource}
        language={props.pane.note?.entry.kind === "typst" ? "Typst" : undefined}
        class="min-h-0 flex-1" classes={{ content: "px-4 py-2", line: "text-foreground" }}
        fontSize={EDITOR_FONT_SIZE * zoom()} lineHeight={20 * zoom()}
        lineNumbers={false} folding={false} activeLine={false} indentGuides={false}
        softWrap autoClose={false} autoIndent={false} scrollBeyondLastLine={false}
        readOnly={!visible() || props.actions.locked} accessibilityLabel="Note source"
        onFocus={() => {
          if (disposed) return;
          if (visible()) updateFocus(true);
          else editor()?.blur();
        }}
        onBlur={() => updateFocus(false)}
        onSelectionChange={({ selections }) => {
          selection = selections.at(-1);
          reportSelection();
        }}
        onChange={({ value }) => {
          if (disposed) return;
          source = value;
          if (visible()) props.onDraft(value);
          reportSelection();
        }}
      />
    </View>
  );
}
