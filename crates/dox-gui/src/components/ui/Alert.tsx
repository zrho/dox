import { Show, type JSX } from "solid-js";
import X from "lucide-solid/icons/x";
import Button from "./Button";
import { matchesBinding } from "../../utils/commands";
export default function Alert(props: {
  variant?: "warning" | "error";
  children: JSX.Element;
  actions?: JSX.Element;
  onDismiss?: () => void;
  class?: string;
}) {
  return (
    <div
      role={props.variant === "error" ? "alert" : "status"}
      onKeyDown={(event) => {
        if (
          props.onDismiss &&
          !event.defaultPrevented &&
          matchesBinding(event, { key: "escape", primary: false })
        ) {
          event.preventDefault();
          event.stopPropagation();
          props.onDismiss();
        }
      }}
      class={`flex max-h-[200px] items-start justify-between gap-3 overflow-auto px-[18px] py-[10px] text-xs ${props.variant === "error" ? "bg-danger-surface text-destructive" : "bg-warning-surface text-warning"} ${props.class ?? ""}`}
    >
      <div class="min-w-0">{props.children}</div>
      {props.actions}
      <Show when={props.onDismiss}>
        <Button aria-label={props.variant === "error" ? "Dismiss error" : "Dismiss warning"} onClick={() => props.onDismiss?.()}>
          <X size={12} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </Show>
    </div>
  );
}
