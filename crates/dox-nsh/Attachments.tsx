import { Scroll, signal, Text, View } from "nsh";
import { Button } from "nsh/base";
import { IconButton } from "./Icon";

function fileSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

export function Attachments(props: {
  files: readonly { name: string; size?: number }[];
  busy?: boolean;
  onAdd: () => void;
  onOpen: (name: string) => void;
  onRemove: (name: string) => void;
}) {
  const expanded = signal(true);

  return (
    <If when={props.files.length > 0}>
      <View class="shrink-0 border-t border-border">
        <View class="flex-row">
          <Button
            class="min-w-0 flex-1 px-2 py-1.5 hover:bg-muted"
            accessibilityLabel={`${expanded() ? "Collapse" : "Expand"} attachments (${props.files.length})`}
            onPress={() => expanded.set(!expanded())}
          >
            <Text class="text-xs text-muted-foreground">ATTACHMENTS · {props.files.length}</Text>
          </Button>
          <View class="justify-center pr-2">
            <IconButton icon="add" label="Add attachment" disabled={props.busy} onPress={props.onAdd} />
          </View>
        </View>
        <If when={expanded()}>
          <Scroll style={{ maxHeight: 120 }}>
            <Each of={props.files} key={(file) => file.name}>
              {(file) => (
                <View class="flex-row items-center">
                  <Button
                    class="min-w-0 flex-1 flex-row items-center gap-2 px-2 py-1 hover:bg-muted disabled:opacity-50"
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
          </Scroll>
        </If>
      </View>
    </If>
  );
}
