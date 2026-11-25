import { computed, effect, keymap, List, signal, Text, View, windowSize } from "nsh";
import { Button, Dialog, Input } from "nsh/base";
import type { ListRef } from "nsh/types";
import { Icon, type ItemIcon } from "./Icon";

export type PickerItem = {
  id: string;
  title: string;
  /** Optional trailing text, such as a note ID or a shortcut label. */
  detail?: string;
  icon?: ItemIcon;
  search?: string;
  disabled?: boolean;
};

type PickerProps = {
  title: string;
  placeholder: string;
  items: readonly PickerItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
};

const ROW_HEIGHT = 36;
const LIST_PADDING = 4;

function normalize(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

function matchRank(text: string, term: string): number {
  if (text === term) return 0;
  const position = text.indexOf(term);
  if (position === 0) return 1;
  if (position > 0) return 2 + position / text.length;

  // For a subsequence, prefer compact matches near the start of the text.
  let end = -1;
  let start = -1;
  for (const char of term) {
    end = text.indexOf(char, end + 1);
    if (end < 0) return Infinity;
    if (start < 0) start = end;
  }
  return 3 + (end - start + end) / (2 * text.length);
}

/** Mount only while open. A selection calls onClose before onSelect. */
export function Picker(props: PickerProps) {
  const query = signal("");
  const cursorId = signal<string | null>(null);
  const composing = signal(false);
  let list: ListRef | undefined;
  let closing = false;

  const candidates = computed(() => props.items.map((item) => ({
    item,
    fields: [item.title, item.id, item.search ?? "", item.detail ?? ""].map(normalize),
  })));
  const matches = computed(() => {
    const needle = normalize(query().trim());
    if (!needle) return props.items;
    const terms = needle.split(/\s+/);
    return candidates()
      .map(({ item, fields }) => ({
        item,
        rank: terms.reduce((total, term) => total + Math.min(
          ...fields.map((field, index) => matchRank(field, term) + index * 0.15),
        ), 0),
      }))
      .filter(({ rank }) => Number.isFinite(rank))
      .sort((a, b) => a.rank - b.rank)
      .map(({ item }) => item);
  });
  const activeIndex = computed(() => {
    const items = matches();
    const id = cursorId();
    const current = id === null ? -1 : items.findIndex((item) => item.id === id && !item.disabled);
    return current >= 0 ? current : items.findIndex((item) => !item.disabled);
  });
  const listHeight = computed(() => Math.min(
    Math.max(1, matches().length) * ROW_HEIGHT + 2 * LIST_PADDING,
    360,
    Math.max(ROW_HEIGHT + 2 * LIST_PADDING, (windowSize().height || 600) * 0.6),
  ));

  function moveCursor(direction: -1 | 1) {
    const items = matches();
    let index = activeIndex();
    if (index < 0) return;
    for (let step = 0; step < items.length; step++) {
      index = (index + direction + items.length) % items.length;
      if (items[index].disabled) continue;
      cursorId.set(items[index].id);
      list?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
      return;
    }
  }

  function close() {
    if (closing) return;
    closing = true;
    props.onClose();
  }

  function choose(item: PickerItem | undefined) {
    if (closing || !item || item.disabled) return;
    const select = props.onSelect;
    close();
    select(item.id);
  }

  effect(() => {
    if (composing()) return;
    // AppKit's field editor normally handles arrows before they reach the picker.
    return keymap.bind({ up: () => moveCursor(-1), down: () => moveCursor(1) }, {
      when: "always", repeat: true,
    });
  });

  return (
    // Dialog presents in a native layer above the workspace, including its web view.
    <Dialog
      animation="none"
      accessibilityLabel={props.title}
      backdropStyle={{ backgroundColor: "#00000033" }}
      onOpenChange={({ open }) => { if (!open) close(); }}
      class="rounded-lg border border-border bg-background"
      style={{ alignSelf: "center", top: "14%", width: "92%", maxWidth: 560, boxShadow: "0 16px 48px #00000040" }}
    >
      <View>
        <View class="gap-1 border-b border-border px-3 py-2">
          <Text class="text-xs font-semibold text-muted-foreground line-clamp-1">{props.title}</Text>
          <Input
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            class="rounded-md bg-muted px-2 py-2 text-sm text-foreground"
            accessibilityLabel={props.title}
            placeholder={props.placeholder}
            value={query()}
            onChange={({ value }) => {
              query.set(value);
              cursorId.set(null);
              const index = activeIndex();
              if (index > 0) list?.scrollToIndex({ index, animated: false });
              else list?.scrollToOffset({ offset: 0, animated: false });
            }}
            onCompositionChange={(event) => composing.set(event.composing)}
            submitBehavior="submit"
            onSubmit={() => { if (!composing()) choose(matches()[activeIndex()]); }}
          />
        </View>
        <List
          ref={(node) => { list = node; }}
          style={{ height: listHeight() }}
          contentStyle={{ padding: LIST_PADDING }}
          estimatedItemSize={ROW_HEIGHT}
          each={matches()}
          keyExtractor={(item) => item.id}
          empty={() => <Text class="px-2 py-2 text-sm text-muted-foreground">No matches</Text>}
        >
          {(item, index) => (
            <Button
              class="flex-row items-center gap-3 rounded-md px-2 hover:bg-muted selected:bg-muted disabled:opacity-50"
              style={{ height: ROW_HEIGHT }}
              disabled={item().disabled}
              selected={activeIndex() === index()}
              accessibilityLabel={[item().title, item().icon, item().detail].filter(Boolean).join(", ")}
              onPress={() => choose(item())}
            >
              <If when={item().icon}>{(icon) => <Icon name={icon()} />}</If>
              <Text class="flex-1 text-sm text-foreground line-clamp-1" style={{ minWidth: 0 }}>{item().title}</Text>
              {!!item().detail && (
                <Text class="text-xs text-muted-foreground line-clamp-1" style={{ maxWidth: "40%" }}>{item().detail}</Text>
              )}
            </Button>
          )}
        </List>
      </View>
    </Dialog>
  );
}
