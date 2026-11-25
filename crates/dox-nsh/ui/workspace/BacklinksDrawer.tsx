import { Button } from "nsh/base";
import { Drawer } from "../design/Drawer";
import { NoteTitle } from "../design/NoteTitle";
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
            <Button class="h-5 justify-center px-2 hover:bg-muted" accessibilityLabel={item().title} onPress={() => props.onNavigate(item().id)}>
              <NoteTitle title={item().title} spans={item().title_spans} class="text-xs text-foreground line-clamp-1" />
            </Button>
          )}
        </Each>
      )} />
  );
}
