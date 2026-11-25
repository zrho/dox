import { effect, keymap, signal, Text, View } from "nsh";
import { Button, Dialog, Input } from "nsh/base";

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
    <Dialog
      open={open()}
      animation="none"
      accessibilityLabel="Import publication"
      accessibilityDescription={DESCRIPTION}
      backdropStyle={{ backgroundColor: "#00000033" }}
      closeOnEscape={false}
      closeOnBackdropPress={false}
      closeOnSwipe={false}
      onCancel={close}
      class="rounded-lg border border-border bg-background"
      style={{ alignSelf: "center", top: "14%", width: "92%", maxWidth: 560, boxShadow: "0 16px 48px #00000040" }}
    >
      <View class="gap-2 px-4 py-3">
        <Text class="text-sm font-semibold text-foreground">Import publication</Text>
        <Text class="text-xs text-muted-foreground">{DESCRIPTION}</Text>
        <Input
          autoFocus autoCapitalize="none" autoCorrect={false} readonly={busy()}
          class="rounded-md bg-muted px-2 py-2 text-sm text-foreground"
          accessibilityLabel="Publication identifier or link"
          placeholder="10.1038/… or https://arxiv.org/abs/…"
          value={input()}
          onChange={({ value }) => {
            if (busy()) return;
            input.set(value);
            error.set("");
          }}
          onCompositionChange={({ composing: active }) => composing.set(active)}
          submitBehavior="submit"
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
    </Dialog>
  );
}
