import { cn } from "../../utils/cn";
import { splitProps, type JSX } from "solid-js";
export default function Kbd(props: JSX.HTMLAttributes<HTMLElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return (
    <kbd
      {...rest}
      class={cn("shrink-0 font-sans text-[10px] text-muted", local.class)}
    />
  );
}
