import { cn } from "../../utils/cn";
import { createSignal, Show, splitProps, type JSX } from "solid-js";
import Tooltip from "./Tooltip";

const variants = {
  default: "hover:bg-hover",
  ghost: "text-muted hover:bg-hover hover:text-foreground",
  danger: "text-muted hover:bg-danger-surface hover:text-destructive",
  link: "text-accent hover:underline",
} as const;
const sizes = {
  default: "px-[9px] py-[5px]",
  small: "px-[6px] py-[2px] text-[11px] leading-5",
  icon: "inline-flex size-6 items-center justify-center p-[3px]",
  row: "flex h-[22px] items-center px-1 py-0",
  inline: "px-[3px] py-0 leading-3",
} as const;
export type ButtonProps = Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick"
> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  selected?: boolean;
  busy?: boolean;
  tooltip?: string;
  onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
};

/** Action button. Icon-only actions use size="icon" and an accessible label. */
export default function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, [
    "variant",
    "size",
    "selected",
    "busy",
    "tooltip",
    "class",
    "classList",
    "onClick",
    "ref",
  ]);
  const [hovered, setHovered] = createSignal(false);
  const [focused, setFocused] = createSignal(false);
  let anchor: HTMLButtonElement | undefined;
  const tooltip = () =>
    local.tooltip ?? (local.size === "icon" ? rest["aria-label"] : undefined);
  const control = (
    <button
      type="button"
      {...rest}
      ref={(element) => {
        anchor = element;
        if (typeof local.ref === "function") local.ref(element);
      }}
      data-slot="button"
      class={cn(
        "cursor-pointer rounded border border-transparent text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-40 aria-disabled:cursor-default",
        variants[local.variant ?? "default"],
        sizes[local.size ?? "default"],
        local.selected && "bg-selection text-accent hover:bg-selection",
        local.class,
      )}
      classList={local.classList}
      aria-pressed={local.selected ?? rest["aria-pressed"]}
      aria-disabled={local.busy || rest.disabled || rest["aria-disabled"]}
      onClick={(event) => {
        if (!local.busy && !rest.disabled) local.onClick?.(event);
      }}
    />
  );
  return (
    <Show when={tooltip()} fallback={control}>
      <span
        class="inline-flex shrink-0 items-center"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusIn={() => setFocused(true)}
        onFocusOut={() => setFocused(false)}
      >
        {control}
        <Tooltip
          anchor={hovered() || focused() ? anchor : undefined}
          text={tooltip()}
        />
      </span>
    </Show>
  );
}
