import { cn } from "../../utils/cn";
import {
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";

/** Controlled tooltip for ordinary elements or delegated links in a Shadow DOM. */
export default function Tooltip(props: {
  anchor?: HTMLElement;
  text?: string;
  delay?: number;
  class?: string;
}) {
  const id = createUniqueId();
  const [visible, setVisible] = createSignal(false);
  const [position, setPosition] = createSignal({ left: 0, top: 0 });
  let bubble: HTMLDivElement | undefined;
  createEffect(() => {
    const anchor = props.anchor;
    const text = props.text;
    setVisible(false);
    if (!anchor || !text) return;
    // ARIA ID references cannot cross a shadow boundary. Give those links a
    // descriptive accessible name instead of referencing an unreachable portal.
    const shadow = anchor.getRootNode() instanceof ShadowRoot;
    const attribute = shadow ? "aria-label" : "aria-describedby";
    const previous = anchor.getAttribute(attribute);
    anchor.setAttribute(
      attribute,
      shadow
        ? `${anchor.textContent?.trim() ?? ""}: ${text}`
        : [previous, id].filter(Boolean).join(" "),
    );
    function place() {
      if (!anchor?.isConnected || !anchor.getClientRects().length) {
        setVisible(false);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const width = bubble?.offsetWidth ?? 280;
      const height = bubble?.offsetHeight ?? 36;
      const left = Math.max(
        8,
        Math.min(
          rect.left + rect.width / 2 - width / 2,
          window.innerWidth - width - 8,
        ),
      );
      const top =
        rect.top >= height + 16
          ? rect.top - height - 8
          : Math.min(rect.bottom + 8, window.innerHeight - height - 8);
      setPosition({ left, top });
    }
    const timer = setTimeout(() => {
      setVisible(true);
      queueMicrotask(place);
    }, props.delay ?? 300);
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearTimeout(timer);
        setVisible(false);
      }
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("keydown", dismiss);
    onCleanup(() => {
      clearTimeout(timer);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("keydown", dismiss);
      if (previous == null) anchor.removeAttribute(attribute);
      else anchor.setAttribute(attribute, previous);
    });
  });
  return (
    <Show when={visible()}>
      <Portal>
        <TooltipContent
          ref={(element) => {
            bubble = element;
          }}
          id={id}
          text={props.text}
          left={position().left}
          top={position().top}
          class={props.class}
        />
      </Portal>
    </Show>
  );
}

export function TooltipContent(props: {
  ref: (element: HTMLDivElement) => void;
  id: string;
  text?: string;
  left: number;
  top: number;
  class?: string;
}) {
  return (
    <div
      ref={props.ref}
      id={props.id}
      role="tooltip"
      data-slot="tooltip"
      class={cn(
        "pointer-events-none fixed z-100 max-w-[min(360px,calc(100vw_-_16px))] rounded border border-border-strong bg-popover px-[9px] py-[6px] font-sans text-xs leading-[1.4] wrap-anywhere text-foreground shadow-lg",
        props.class,
      )}
      style={{ left: `${props.left}px`, top: `${props.top}px` }}
    >
      {props.text}
    </div>
  );
}
