import type { JSX } from "solid-js";

/** App frame only; page content and status are supplied as slots. */
export default function AppShell(props: {
  header: JSX.Element;
  titlebar?: boolean;
  overlays?: JSX.Element;
  status?: JSX.Element;
  children: JSX.Element;
  mainRef: (element: HTMLElement) => void;
}) {
  return (
    <div
      class="flex h-dvh flex-col overflow-hidden border-border bg-background text-foreground"
      classList={{ "border-t": !props.titlebar }}
    >
      {props.titlebar && props.header}
      <div class="flex min-h-0 flex-1 overflow-hidden">
        <main
          ref={props.mainRef}
          tabIndex={-1}
          class="flex min-w-0 flex-1 flex-col bg-background"
        >
          {!props.titlebar && props.header}
          {props.children}
        </main>
      </div>
      <footer
        aria-label="Status bar"
        class="flex h-[22px] shrink-0 items-baseline gap-2 overflow-hidden border-t border-border bg-chrome px-2 text-[10px] leading-[22px]"
      >
        {props.status}
      </footer>
      {props.overlays}
    </div>
  );
}
