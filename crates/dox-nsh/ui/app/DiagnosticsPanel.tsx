import { Scroll, Text, View } from "nsh";
import { Button } from "nsh/base";
import { canOpenDiagnostic, type Issue } from "./sessionTypes";
import type { Entry } from "../workspace/paneState";

export function DiagnosticsPanel(props: {
  issues: readonly Issue[];
  entries: readonly Entry[];
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (issue: Issue) => void;
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
              {(issue) => <Button class="flex-col items-start border-t border-border px-2 py-1 hover:bg-muted"
                disabled={props.busy || !canOpenDiagnostic(issue(), props.entries)}
                onPress={() => {
                  const diagnostic = issue();
                  if (!props.busy && canOpenDiagnostic(diagnostic, props.entries)) props.onOpen(diagnostic);
                }}>
                <Text class="text-xs text-foreground">{issue().severity.toUpperCase()} · {issue().note_id ?? "Library"}{issue().line ? `:${issue().line}` : ""} · {issue().message}</Text>
                <If when={issue().document}>
                  <Text class="text-xs text-muted-foreground">{issue().document}{issue().line ? `:${issue().line}:${issue().column ?? 1}` : ""}</Text>
                </If>
              </Button>}
            </Each>
          </Scroll>
        </If>
      </View>
    </If>
  );
}
