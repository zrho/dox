import type { JSX } from "solid-js";

/** App frame only; page content and navigation are supplied as slots. */
export default function AppShell(props: {
  sidebar: JSX.Element;
  sidebarVisible: boolean;
  header: JSX.Element;
  footer: JSX.Element;
  overlays?: JSX.Element;
  children: JSX.Element;
  sidebarRef: (element: HTMLElement) => void;
  mainRef: (element: HTMLElement) => void;
}) {
  return (
    <div class="flex h-dvh overflow-hidden border-t border-border bg-background text-foreground">
      <aside
        ref={props.sidebarRef}
        hidden={!props.sidebarVisible}
        class="flex w-[254px] shrink-0 flex-col border-r border-border bg-panel"
      >
        <nav
          class="min-h-0 flex-1 overflow-auto pt-[2px] pb-1"
          aria-label="Libraries"
        >
          {props.sidebar}
        </nav>
      </aside>
      <main
        ref={props.mainRef}
        tabIndex={-1}
        class="flex min-w-0 flex-1 flex-col bg-background"
      >
        {props.header}
        {props.children}
        {props.footer}
      </main>
      {props.overlays}
    </div>
  );
}
