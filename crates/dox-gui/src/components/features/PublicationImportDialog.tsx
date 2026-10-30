import { createEffect, createSignal, createUniqueId, Show } from "solid-js";
import Dialog from "../ui/Dialog";
import TextInput from "../ui/TextInput";
import Button from "../ui/Button";

/** Owns only the import form; identifier resolution and storage live in Rust. */
export default function PublicationImportDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (input: string) => Promise<void>;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [input, setInput] = createSignal("");
  const [error, setError] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const inputId = createUniqueId();
  const errorId = createUniqueId();
  let field: HTMLInputElement | undefined;
  createEffect(() => {
    if (props.open) {
      setInput("");
      setError("");
    }
  });
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (submitting() || !input().trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await props.onImport(input().trim());
      props.onOpenChange(false);
    } catch (error) {
      setError(String(error));
      field?.focus();
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!submitting()) props.onOpenChange(open);
      }}
      title="Import publication from link or tag"
      titleClass="mb-2 text-sm font-medium"
      description="Enter a DOI, arXiv ID, or publication link."
      class="p-4"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        field?.focus();
      }}
      onCloseAutoFocus={props.onCloseAutoFocus}
      onEscapeKeyDown={(event) => {
        if (submitting()) event.preventDefault();
      }}
    >
      <form onSubmit={submit} aria-busy={submitting()}>
        <label for={inputId} class="sr-only">
          Publication identifier or link
        </label>
        <TextInput
          id={inputId}
          ref={(element) => {
            field = element;
          }}
          placeholder="10.1038/… or https://arxiv.org/abs/…"
          value={input()}
          onInput={(event) => {
            setInput(event.currentTarget.value);
            setError("");
          }}
          readOnly={submitting()}
          aria-invalid={!!error()}
          aria-describedby={error() ? errorId : undefined}
          autocomplete="off"
          spellcheck={false}
        />
        <Show when={error()}>
          <p id={errorId} role="alert" class="mt-3 text-xs text-destructive">
            {error()}
          </p>
        </Show>
        <div class="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            disabled={submitting()}
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={submitting() || !input().trim()}
            class="border-border bg-selection text-foreground"
          >
            {submitting() ? "Importing…" : "Import publication"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
