import { cn } from "../../utils/cn";
import { splitProps, type JSX } from "solid-js";
export type TextInputProps = JSX.InputHTMLAttributes<HTMLInputElement> & {
  variant?: "default" | "search";
};

export default function TextInput(props: TextInputProps) {
  const [local, rest] = splitProps(props, ["class", "variant"]);
  return (
    <input
      type="text"
      {...rest}
      data-slot="input"
      class={cn(
        "min-w-0 w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40",
        local.variant === "search"
          ? "rounded-none border-0 bg-transparent px-0 py-[5px] text-sm outline-none focus-visible:outline-none"
          : "rounded-[5px] border border-border bg-background px-[10px] py-2",
        local.class,
      )}
    />
  );
}
