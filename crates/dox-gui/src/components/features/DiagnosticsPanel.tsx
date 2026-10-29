import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import Button from "../ui/Button";
import InfoPanel from "../ui/InfoPanel";
import type { Diagnostic, Severity } from "../../types";

export default function DiagnosticsPanel(props: {
  diagnostics: Diagnostic[];
  noteIds: string[];
  busy: boolean;
  onOpen: (diagnostic: Diagnostic) => void;
}) {
  const [expanded, setExpanded] = createSignal(true);
  const [filter, setFilter] = createSignal<Severity>();
  const visible = createMemo(() =>
    props.diagnostics.filter(
      (issue) => !filter() || issue.severity === filter(),
    ),
  );
  createEffect(() => {
    const severity = filter();
    if (
      severity &&
      !props.diagnostics.some((issue) => issue.severity === severity)
    )
      setFilter(undefined);
  });
  return (
    <DiagnosticsView
      {...props}
      expanded={expanded()}
      filter={filter()}
      visible={visible()}
      onExpandedChange={setExpanded}
      onFilter={(severity) => {
        setFilter(filter() === severity ? undefined : severity);
        setExpanded(true);
      }}
    />
  );
}

const severities: Severity[] = ["error", "warning", "proposal"];
const severityColor = {
  error: "text-destructive",
  warning: "text-warning",
  proposal: "text-accent",
};
type DiagnosticsViewProps = {
  diagnostics: Diagnostic[];
  visible: Diagnostic[];
  noteIds: string[];
  busy: boolean;
  expanded: boolean;
  filter?: Severity;
  onExpandedChange: (expanded: boolean) => void;
  onFilter: (severity: Severity) => void;
  onOpen: (diagnostic: Diagnostic) => void;
};
function DiagnosticsView(props: DiagnosticsViewProps) {
  return (
    <Show when={props.diagnostics.length}>
      <InfoPanel
        title="DIAGNOSTICS"
        expanded={props.expanded}
        onExpandedChange={props.onExpandedChange}
        actions={
          <For each={severities}>
            {(severity) => (
              <Button
                size="small"
                class={`text-[10px] ${severityColor[severity]}`}
                selected={props.filter === severity}
                onClick={() => props.onFilter(severity)}
              >
                {
                  props.diagnostics.filter(
                    (issue) => issue.severity === severity,
                  ).length
                }{" "}
                {severity === "proposal" ? "proposals" : `${severity}s`}
              </Button>
            )}
          </For>
        }
      >
        <For each={props.visible}>
          {(diagnostic) => (
            <DiagnosticRow
              diagnostic={diagnostic}
              canOpen={
                !!diagnostic.note_id &&
                props.noteIds.includes(diagnostic.note_id)
              }
              busy={props.busy}
              onOpen={props.onOpen}
            />
          )}
        </For>
      </InfoPanel>
    </Show>
  );
}
function DiagnosticRow(props: {
  diagnostic: Diagnostic;
  canOpen: boolean;
  busy: boolean;
  onOpen: (diagnostic: Diagnostic) => void;
}) {
  return (
    <div
      class={`flex min-h-[23px] items-baseline gap-2 border-t border-border ${severityColor[props.diagnostic.severity]}`}
    >
      <Button
        size="inline"
        class="min-w-12 shrink-0 py-[3px] font-mono text-[10px]"
        disabled={!props.canOpen}
        busy={props.busy}
        title={props.diagnostic.document ?? undefined}
        onClick={() => props.onOpen(props.diagnostic)}
      >
        {props.diagnostic.note_id ?? "Library"}
        {props.diagnostic.line ? `:${props.diagnostic.line}` : ""}
      </Button>
      <details class="min-w-0 flex-1 py-[3px]">
        <summary class="cursor-pointer truncate">
          <span class="mr-[7px] text-[9px] opacity-75">
            {props.diagnostic.code}
          </span>{" "}
          {props.diagnostic.message.split("\n")[0]}
        </summary>
        <pre class="my-[6px] font-mono text-[11px] leading-[1.5] whitespace-pre-wrap wrap-anywhere text-foreground">
          {props.diagnostic.message}
        </pre>
        <Show when={props.diagnostic.document}>
          <div class="my-1 font-mono text-[10px] text-muted">
            {props.diagnostic.document}
            {props.diagnostic.line
              ? `:${props.diagnostic.line}:${props.diagnostic.column ?? 1}`
              : ""}
          </div>
        </Show>
        <For each={props.diagnostic.actions}>
          {(action) => (
            <div class="my-1 text-[11px] text-accent">{action.title}</div>
          )}
        </For>
      </details>
    </div>
  );
}
