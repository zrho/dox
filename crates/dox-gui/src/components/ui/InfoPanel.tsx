import { cn } from "../../utils/cn";
import { createSignal, createUniqueId, Show, type JSX } from "solid-js";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Button from "./Button";
export type InfoPanelViewProps = {
  title: string;
  count?: number;
  class?: string;
  bodyClass?: string;
  expanded: boolean;
  contentId: string;
  onToggle: () => void;
  actions?: JSX.Element;
  children: JSX.Element;
};
/** Controlled disclosure markup, also usable without the stateful wrapper. */
export function InfoPanelView(props: InfoPanelViewProps) {
  return (
    <section
      class={cn(
        "shrink-0 border-t border-border bg-panel text-[11px]",
        props.class,
      )}
      aria-label={props.title}
    >
      <header class="flex min-h-[25px] items-center gap-1 px-2 py-px">
        <h2 class="mr-2 shrink-0 text-[9px] leading-[18px] font-medium tracking-[1px] text-muted">
          <Button
            size="inline"
            class="flex items-center gap-[6px] py-[2px] text-inherit"
            aria-expanded={props.expanded}
            aria-controls={props.contentId}
            onClick={props.onToggle}
          >
            <ChevronRight
              class={`size-[10px] shrink-0 text-muted ${props.expanded ? "rotate-90" : ""}`}
              strokeWidth={1.5}
              aria-hidden="true"
            />
            {props.title}
            <Show when={props.count !== undefined}>
              <span class="text-[9px] tracking-normal text-subtle">
                {props.count}
              </span>
            </Show>
          </Button>
        </h2>
        {props.actions}
      </header>
      <div
        id={props.contentId}
        hidden={!props.expanded}
        class={cn(
          "max-h-[170px] overflow-auto px-[10px] pb-1 hidden:hidden",
          props.bodyClass,
        )}
      >
        {props.children}
      </div>
    </section>
  );
}
export default function InfoPanel(
  props: Omit<InfoPanelViewProps, "expanded" | "contentId" | "onToggle"> & {
    expanded?: boolean;
    onExpandedChange?: (expanded: boolean) => void;
    defaultExpanded?: boolean;
  },
) {
  const [localExpanded, setLocalExpanded] = createSignal(
    props.defaultExpanded ?? true,
  );
  const contentId = createUniqueId();
  const expanded = () => props.expanded ?? localExpanded();
  return (
    <InfoPanelView
      {...props}
      expanded={expanded()}
      contentId={contentId}
      onToggle={() => {
        const next = !expanded();
        if (props.expanded === undefined) setLocalExpanded(next);
        props.onExpandedChange?.(next);
      }}
    />
  );
}
