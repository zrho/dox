import { createEffect, onCleanup, onMount, untrack } from "solid-js";
import { history, historyKeymap, isolateHistory, standardKeymap } from "@codemirror/commands";
import {
  defineLanguageFacet,
  HighlightStyle,
  Language,
  languageDataProp,
  syntaxHighlighting,
} from "@codemirror/language";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  typstLezerHighlighting,
  typstParser,
  typstTags,
} from "codemirror-lang-typst/lezer";

/** Session commands use this interface rather than CodeMirror's DOM internals. */
export type NoteEditorHandle = {
  focus: (options?: FocusOptions) => void;
  readonly hasFocus: boolean;
  readonly isConnected: boolean;
  readonly selection: { start: number; end: number };
  scrollTop: number;
  setSelection: (start: number, end: number) => void;
  revealPosition: (position: number) => void;
  replaceRange: (start: number, end: number, text: string) => void;
};

// Install only parsing/highlighting, without the package's default theme,
// list keybindings, completion data, or syntax linter.
const typstData = defineLanguageFacet();
const typstLanguage = new Language(
  typstData,
  typstParser.configure({ props: [
    languageDataProp.add((node) => node.isTop ? typstData : undefined),
    typstLezerHighlighting,
  ] }),
  [],
  "typst",
);
const highlighting = HighlightStyle.define([
  { tag: tags.comment, color: "#828e9f" },
  { tag: [tags.keyword, tags.bool], color: "#8259a8" },
  { tag: tags.string, color: "#527645" },
  { tag: tags.number, color: "#95602f" },
  { tag: [tags.function(tags.variableName), tags.propertyName], color: "#396b91" },
  { tag: [tags.escape, tags.link, typstTags.interpolated], color: "#397b80" },
  { tag: [tags.heading, tags.strong, tags.emphasis], color: "#4e607c" },
  { tag: [tags.punctuation, tags.operator, typstTags.mathDelimiter, typstTags.listMarker], color: "#687080" },
]);
const theme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--color-document-foreground)",
    backgroundColor: "var(--color-document-background)",
    colorScheme: "light",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-editor)",
    lineHeight: "1.5",
    overflow: "auto",
    overscrollBehavior: "none",
  },
  ".cm-content": {
    padding: "8px 0",
    caretColor: "var(--color-document-foreground)",
    textWrap: "wrap",
  },
  ".cm-line": { padding: "0 12px" },
  ".cm-content ::selection, .cm-content::selection": {
    backgroundColor: "var(--color-document-selection)",
    color: "var(--color-document-foreground)",
  },
});

export default function NoteEditor(props: {
  source: string;
  typst: boolean;
  visible: boolean;
  readOnly?: boolean;
  zoom: number;
  onSourceChange: (source: string) => void;
  editorRef: (editor: NoteEditorHandle) => void;
}) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;
  const language = new Compartment();
  const attributes = new Compartment();
  const size = new Compartment();
  const editorAttributes = () => [
    EditorState.readOnly.of(!!props.readOnly),
    EditorView.contentAttributes.of({
      "aria-label": props.typst ? "Typst source" : "BibTeX source",
      "aria-readonly": String(!!props.readOnly),
      spellcheck: "false",
    }),
  ];
  const editorSize = () => EditorView.theme({
    "&": { fontSize: `${(13 * props.zoom) / 100}px` },
  });
  function state(source: string) {
    return EditorState.create({
      doc: source,
      extensions: [
        theme,
        size.of(editorSize()),
        attributes.of(editorAttributes()),
        language.of(props.typst ? typstLanguage : []),
        syntaxHighlighting(highlighting),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        history(),
        // Files belong to the native attachment handler, rather than being
        // read and inserted as text by CodeMirror's default drop handler.
        EditorView.domEventHandlers({
          drop: (event) => event.dataTransfer?.types.includes("Files") ?? false,
        }),
        keymap.of([
          {
            key: "Tab",
            run: (editor) => {
              if (editor.state.readOnly) return false;
              editor.dispatch(editor.state.replaceSelection("  "), {
                scrollIntoView: true,
                userEvent: "input.type",
              });
              return true;
            },
          },
          ...historyKeymap,
          ...standardKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged)
            props.onSourceChange(update.state.doc.toString());
        }),
      ],
    });
  }
  onMount(() => {
    const editor = new EditorView({ parent: host, state: state(props.source) });
    view = editor;
    const clamp = (position: number) =>
      Math.max(0, Math.min(position, editor.state.doc.length));
    props.editorRef({
      focus: (options) => {
        if (options?.preventScroll) editor.contentDOM.focus(options);
        else editor.focus();
      },
      get hasFocus() { return editor.hasFocus; },
      get isConnected() { return editor.dom.isConnected; },
      get selection() {
        const { from, to } = editor.state.selection.main;
        return { start: from, end: to };
      },
      get scrollTop() { return editor.scrollDOM.scrollTop; },
      set scrollTop(top: number) {
        editor.scrollDOM.scrollTop = top;
        editor.requestMeasure();
      },
      setSelection: (start, end) => {
        editor.dispatch({ selection: { anchor: clamp(start), head: clamp(end) } });
      },
      revealPosition: (position) => {
        const target = clamp(position);
        editor.dispatch({
          selection: { anchor: target },
          effects: EditorView.scrollIntoView(target, { y: "center" }),
        });
      },
      replaceRange: (start, end, text) => {
        const from = clamp(start);
        const to = clamp(end);
        editor.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          annotations: [Transaction.userEvent.of("input"), isolateHistory.of("full")],
        });
      },
    });
    // Keep the instance through edit/view switches so undo and selection survive.
    createEffect(() => {
      const source = props.source;
      if (source === editor.state.doc.toString()) return;
      untrack(() => {
        const { anchor, head } = editor.state.selection.main;
        const top = editor.scrollDOM.scrollTop;
        // A replacement from disk starts a new history, avoiding undo into an
        // obsolete saved document. Local edits already match and skip this path.
        const next = state(source);
        editor.setState(next.update({ selection: {
          anchor: Math.min(anchor, source.length),
          head: Math.min(head, source.length),
        } }).state);
        editor.scrollDOM.scrollTop = top;
      });
    });
    createEffect(() => {
      editor.dispatch({ effects: attributes.reconfigure(editorAttributes()) });
    });
    createEffect(() => {
      editor.dispatch({ effects: size.reconfigure(editorSize()) });
    });
    createEffect(() => {
      editor.dispatch({ effects: language.reconfigure(props.typst ? typstLanguage : []) });
    });
    createEffect(() => {
      if (props.visible) editor.requestMeasure();
    });
  });
  onCleanup(() => view?.destroy());
  return <div ref={host} class="h-full min-h-0" />;
}
