import { Dialog as Primitive } from "@kobalte/core/dialog";
import { Show, type JSX } from "solid-js";
import { cn } from "../../utils/cn";

/** Controlled modal with shared presentation, focus management, and dismissal. */
export default function Dialog(props: {
  open: boolean;
  title: string;
  description?: string;
  titleClass?: string;
  class?: string;
  children: JSX.Element;
  onOpenChange: (open: boolean) => void;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
}) {
  return (
    <Primitive open={props.open} onOpenChange={props.onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay class="fixed inset-0 z-20 bg-overlay/20" />
        <Primitive.Content
          class={cn(
            "fixed top-[14vh] left-1/2 z-21 w-[min(560px,calc(100vw_-_48px))] -translate-x-1/2 overflow-hidden rounded-[7px] border border-border-strong bg-popover shadow-[0_16px_64px] shadow-overlay/15",
            props.class,
          )}
          onOpenAutoFocus={props.onOpenAutoFocus}
          onCloseAutoFocus={props.onCloseAutoFocus}
          onEscapeKeyDown={(event) => {
            event.stopPropagation();
            props.onEscapeKeyDown?.(event);
          }}
        >
          <Primitive.Title class={props.titleClass ?? "sr-only"}>
            {props.title}
          </Primitive.Title>
          <Show when={props.description}>
            <Primitive.Description class="mb-3 text-xs text-muted">
              {props.description}
            </Primitive.Description>
          </Show>
          {props.children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive>
  );
}
