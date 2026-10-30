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
  let previousFocus: HTMLElement | undefined;
  const onOpenAutoFocus = (event: Event) => {
    let focused = document.activeElement;
    while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
    previousFocus = focused instanceof HTMLElement ? focused : undefined;
    props.onOpenAutoFocus?.(event);
  };
  const onCloseAutoFocus = (event: Event) => {
    props.onCloseAutoFocus?.(event);
    // These dialogs open from commands rather than Dialog.Trigger. Restore the
    // actual previous element, unless a caller or a new view already took focus.
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  return (
    <Primitive open={props.open} onOpenChange={props.onOpenChange}>
      <Primitive.Portal>
        <Primitive.Content
          class={cn(
            "fixed top-[14vh] left-1/2 z-21 w-[min(560px,calc(100vw_-_48px))] -translate-x-1/2 overflow-hidden rounded-[7px] border border-border-strong bg-popover shadow-[0_16px_64px] shadow-overlay/15",
            props.class,
          )}
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={onCloseAutoFocus}
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
