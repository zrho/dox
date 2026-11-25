import { Text, View } from "nsh";
import { Button } from "nsh/base";
import { Drawer } from "../design/Drawer";
import { IconButton } from "../design/IconButton";
import type { Attachment } from "./paneState";

function fileSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

export function AttachmentsDrawer(props: {
  files: readonly Attachment[];
  busy?: boolean;
  onAdd: () => void;
  onOpen: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  return (
    <Drawer title="Attachments" label="attachments" count={props.files.length}
      renderAction={() => <IconButton icon="add" label="Add attachment" disabled={props.busy} onPress={props.onAdd} />}
      renderRows={() => (
        <Each of={props.files} key={(file) => file.name}>
          {(file) => (
            <View class="h-5 flex-row items-center">
              <Button
                class="h-full min-w-0 flex-1 flex-row items-center gap-2 px-2 hover:bg-muted disabled:opacity-50"
                accessibilityLabel={`Open attachment ${file().name}`}
                disabled={props.busy}
                onPress={() => { if (!props.busy) props.onOpen(file().name); }}
              >
                <Text class="min-w-0 flex-1 text-xs text-foreground line-clamp-1">{file().name}</Text>
                <Text class="shrink-0 text-xs text-muted-foreground">{fileSize(file().size)}</Text>
              </Button>
              <View class="pr-2">
                <IconButton icon="delete" label={`Remove attachment ${file().name}`} disabled={props.busy} onPress={() => props.onRemove(file().name)} />
              </View>
            </View>
          )}
        </Each>
      )} />
  );
}
