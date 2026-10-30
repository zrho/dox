import { For, Show } from "solid-js";
import File from "lucide-solid/icons/file";
import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import Button from "../ui/Button";
import InfoPanel from "../ui/InfoPanel";
import type { Attachment } from "../../types";

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** File actions belong to the session; this panel only renders attachments. */
export default function AttachmentsPanel(props: {
  attachments: Attachment[];
  busy: boolean;
  onAttach: () => void;
  onOpen: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  return (
    <Show when={props.attachments.length}>
      <InfoPanel
        title="ATTACHMENTS"
        count={props.attachments.length}
        bodyClass="max-h-[102px]"
        actions={
          <Button size="icon" class="ml-auto" aria-label="Attach files" busy={props.busy} onClick={props.onAttach}>
            <Plus size={12} strokeWidth={1.5} aria-hidden="true" />
          </Button>
        }
      >
        <For each={props.attachments}>
          {(attachment) => (
            <div class="flex min-w-0 items-center gap-1">
              <Button
                variant="ghost"
                size="row"
                class="min-w-0 flex-1 gap-2 text-[11px]"
                busy={props.busy}
                aria-label={`Open ${attachment.name}`}
                onClick={() => props.onOpen(attachment.name)}
              >
                <File class="size-3 shrink-0 text-muted" strokeWidth={1.5} aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate" title={attachment.name}>{attachment.name}</span>
                <span class="shrink-0 text-[10px] text-subtle tabular-nums">{fileSize(attachment.size)}</span>
              </Button>
              <Button
                size="icon"
                variant="danger"
                busy={props.busy}
                aria-label={`Remove ${attachment.name}`}
                onClick={() => props.onRemove(attachment.name)}
              >
                <X size={12} strokeWidth={1.5} aria-hidden="true" />
              </Button>
            </div>
          )}
        </For>
      </InfoPanel>
    </Show>
  );
}
