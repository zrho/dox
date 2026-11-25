import { Text } from "nsh";
import { Button } from "nsh/base";
import { Drawer } from "../design/Drawer";
import type { Entry } from "./paneState";

export function BacklinksDrawer(props: {
  entries: readonly Entry[];
  id: string;
  onActivate: () => void;
  onNavigate: (id: string) => void;
}) {
  const backlinks = () => props.entries.filter((entry) => entry.links.includes(props.id));

  return (
    <Drawer title="Backlinks" label="backlinks" count={backlinks().length} onToggle={props.onActivate}
      renderRows={() => (
        <Each of={backlinks()} key={(item) => item.id}>
          {(item) => (
            <Button class="h-5 justify-center px-2 hover:bg-muted" onPress={() => props.onNavigate(item().id)}>
              <Text class="text-xs text-foreground line-clamp-1">{item().title}</Text>
            </Button>
          )}
        </Each>
      )} />
  );
}
