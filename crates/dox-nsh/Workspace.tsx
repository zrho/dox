import { computed, effect, Image, Scroll, signal, Text, View } from "nsh";
import sprig from "./sprig.svg";
import type { InputRef, ScrollRef, ViewRef } from "nsh/types";
import { Button, Input } from "nsh/base";
import { Preview } from "./Preview";
import { Attachments } from "./Attachments";
import { IconButton } from "./Icon";

export type Entry = { id: string; title: string; kind: string; date: string | null; links: string[]; revision: string; title_markup: string };
export type Attachment = { name: string; size?: number };
export type Selection = { start: number; end: number };
export type Reading = {
  entry: Entry;
  html: string | null;
  source: string;
  revision: string;
  diagnostics: string[];
  attachments: Attachment[];
  warning?: string | null;
};
export type Pane = {
  key: number; id: string; note?: Reading; error?: string;
  editing?: boolean; draft?: string; saving?: boolean; updating?: boolean; external?: boolean; problem?: string;
};

type PaneActions = {
  busy: boolean;
  locked: boolean;
  onEditor: (key: number, editor: InputRef) => void;
  onSelection: (key: number, selection: Selection) => void;
  onAttach: (key: number) => void;
  onDropAttachments: (key: number, uris: string[]) => void;
  onOpenAttachment: (key: number, name: string) => void;
  onRemoveAttachment: (key: number, name: string) => void;
};

export function dirty(pane: Pane | undefined): boolean {
  return pane?.draft !== undefined && pane.draft !== pane.note?.source;
}

function NotePane(props: {
  pane: Pane;
  width: number;
  active: boolean;
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
  const html = () => props.pane.note?.html ?? null;
  const showPreview = () => html() !== null && !props.pane.editing;
  const source = () => props.pane.draft ?? props.pane.note?.source ?? "";
  const backlinksOpen = signal(true);
  const draggingFiles = signal(false);
  const acceptsDrop = () => !!props.pane.note && !props.actions.busy;
  const backlinks = () => props.entries.filter((entry) => entry.links.includes(props.pane.id));

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
      class="h-full shrink-0 border-x border-border bg-background"
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
      <View class="min-h-0 flex-1">
        <If when={props.pane.external || props.pane.problem}>
          <View class="shrink-0 gap-1 border-b border-border px-3 py-2">
            <If when={props.pane.external}>
              <Text class="text-xs text-muted-foreground">{dirty(props.pane) ? "This note changed on disk. Your draft is preserved." : "This note changed on disk."}</Text>
            </If>
            <If when={props.pane.problem}><Text class="text-xs text-foreground">{props.pane.problem}</Text></If>
          </View>
        </If>
        <If when={!idle()}>
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
                  <Input
                    ref={(editor) => props.actions.onEditor(props.pane.key, editor)}
                    multiline autoFocus={props.active} autoCapitalize="none" autoCorrect={false} readonly={props.actions.locked}
                    onSelectionChange={(range) => props.actions.onSelection(props.pane.key, range)}
                    class="min-h-0 flex-1 px-4 py-2 font-mono text-sm text-foreground"
                    accessibilityLabel="Note source" value={source()}
                    onFocus={() => props.onEditorFocus(true)} onBlur={() => props.onEditorFocus(false)}
                    onChange={({ value }) => props.onDraft(value)}
                  />
                </If>
              </>
            )}
          </If>
        </If>
        <View class="min-h-0" style={!showPreview()
          ? { position: "absolute", top: 0, left: 0, width: 2, height: 2, opacity: 0, pointerEvents: "none" }
          : { flex: 1 }} importantForAccessibility={!showPreview() ? "no-hide-descendants" : "auto"}>
          <Preview html={html()} title={props.pane.note?.entry.title ?? props.pane.id} onActivate={props.onActivate} onNote={props.onNavigate}
            onHorizontalScroll={props.onHorizontalScroll} />
        </View>
      </View>
      <If when={backlinks().length > 0}>
        <View class="shrink-0 border-t border-border">
          <Button class="px-2 py-1.5 hover:bg-muted"
            accessibilityLabel={`${backlinksOpen() ? "Collapse" : "Expand"} backlinks (${backlinks().length})`}
            onPress={() => { props.onActivate(); backlinksOpen.set(!backlinksOpen()); }}>
            <Text class="text-xs text-muted-foreground">BACKLINKS · {backlinks().length}</Text>
          </Button>
          <If when={backlinksOpen()}>
            <Scroll style={{ maxHeight: 96 }}>
              <Each of={backlinks()} key={(item) => item.id}>
                {(item) => (
                  <Button class="px-2 py-1 hover:bg-muted" onPress={() => props.onNavigate(item().id)}>
                    <Text class="text-xs text-foreground line-clamp-1">{item().title}</Text>
                  </Button>
                )}
              </Each>
            </Scroll>
          </If>
        </View>
      </If>
      <Attachments files={props.pane.note?.attachments ?? []} busy={props.actions.busy}
        onAdd={() => props.actions.onAttach(props.pane.key)}
        onOpen={(name) => props.actions.onOpenAttachment(props.pane.key, name)}
        onRemove={(name) => props.actions.onRemoveAttachment(props.pane.key, name)} />
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
    </View>
  );
}

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
                reveal={props.reveal}
                entries={props.entries}
                onActivate={() => props.onActivate(pane().key)}
                onNavigate={props.onNavigate}
                onHorizontalScroll={scrollHorizontally}
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
