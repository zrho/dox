import { Scroll, Text, View } from "nsh";
import { Button } from "nsh/base";
import type { Issue } from "./sessionTypes";

export function DiagnosticsPanel(props: {
  issues: readonly Issue[];
  expanded: boolean;
  onToggle: () => void;
  onNavigate: (id: string) => void;
}) {
  return (
    <If when={props.issues.length > 0}>
      <View class="shrink-0 border-t border-border">
        <Button class="px-2 py-1 hover:bg-muted"
          accessibilityLabel={`${props.expanded ? "Collapse" : "Expand"} diagnostics (${props.issues.length})`}
          onPress={props.onToggle}>
          <Text class="text-xs text-muted-foreground">DIAGNOSTICS · {props.issues.length}</Text>
        </Button>
        <If when={props.expanded}>
          <Scroll style={{ maxHeight: 140 }}>
            <Each of={props.issues} key={(issue) => issue.id}>
              {(issue) => <Button class="border-t border-border px-2 py-1 hover:bg-muted" disabled={!issue().note_id}
                onPress={() => { const id = issue().note_id; if (id) props.onNavigate(id); }}>
                <Text class="text-xs text-foreground">{issue().severity.toUpperCase()}{issue().note_id ? ` · ${issue().note_id}` : ""} · {issue().message}</Text>
              </Button>}
            </Each>
          </Scroll>
        </If>
      </View>
    </If>
  );
}
