import { effect, keymap, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { DialogSurface } from "../design/DialogSurface";
import { SearchField } from "../design/SearchField";

const DESCRIPTION = "Enter a DOI, arXiv ID, or publication link.";

/** Mount a new dialog for each import. */
export function PublicationDialog(props: {
  onImport: (query: string) => Promise<void>;
  onClose: () => void;
}) {
  const open = signal(true);
  const input = signal("");
  const error = signal("");
  const busy = signal(false);
  const composing = signal(false);

  function close() {
    if (busy() || !open()) return;
    open.set(false);
    props.onClose();
  }

  async function submit() {
    const query = input().trim();
    if (!query || busy() || composing() || !open()) return;
    busy.set(true);
    error.set("");
    try {
      await props.onImport(query);
    } catch (reason) {
      error.set((reason instanceof Error ? reason.message : String(reason)) || "Could not import the publication.");
      return;
    } finally {
      busy.set(false);
    }
    close();
  }

  effect(() => {
    if (busy() || composing()) return;
    return keymap.bind("escape", close, { when: "always" });
  });

  return (
    <DialogSurface
      open={open()}
      accessibilityLabel="Import publication"
      accessibilityDescription={DESCRIPTION}
      closeOnEscape={false}
      closeOnBackdropPress={false}
      closeOnSwipe={false}
      onCancel={close}
    >
      <View class="gap-2 px-4 py-3">
        <Text class="text-sm font-semibold text-foreground">Import publication</Text>
        <Text class="text-xs text-muted-foreground">{DESCRIPTION}</Text>
        <SearchField
          readonly={busy()}
          accessibilityLabel="Publication identifier or link"
          placeholder="10.1038/… or https://arxiv.org/abs/…"
          value={input()}
          onChange={({ value }) => {
            if (busy()) return;
            input.set(value);
            error.set("");
          }}
          onCompositionChange={({ composing: active }) => composing.set(active)}
          onSubmit={() => { void submit(); }}
        />
        <If when={error()}>
          <Text class="text-xs text-destructive">{error()}</Text>
        </If>
        <View class="flex-row justify-end gap-2">
          <Button class="rounded-md px-3 py-1.5 hover:bg-muted disabled:opacity-50" disabled={busy()} onPress={close}>
            <Text class="text-xs text-foreground">Cancel</Text>
          </Button>
          <Button
            class="rounded-md border border-border bg-muted px-3 py-1.5 disabled:opacity-50"
            disabled={busy() || composing() || !input().trim()}
            onPress={() => { void submit(); }}
          >
            <Text class="text-xs text-foreground">{busy() ? "Importing…" : "Import"}</Text>
          </Button>
        </View>
      </View>
    </DialogSurface>
  );
}
