import type { JSX } from "solid-js";

/** App frame only; page content and navigation are supplied as slots. */
export default function AppShell(props: {
  sidebar: JSX.Element;
  sidebarVisible: boolean;
  header: JSX.Element;
  titlebar?: boolean;
  overlays?: JSX.Element;
  children: JSX.Element;
  sidebarRef: (element: HTMLElement) => void;
  mainRef: (element: HTMLElement) => void;
}) {
  return (
    <div
      class="flex h-dvh flex-col overflow-hidden border-border bg-background text-foreground"
      classList={{ "border-t": !props.titlebar }}
    >
      {props.titlebar && props.header}
      <div class="flex min-h-0 flex-1 overflow-hidden">
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
          {!props.titlebar && props.header}
          {props.children}
        </main>
      </div>
      <footer
        aria-label="Status bar"
        class="h-[22px] shrink-0 border-t border-border bg-chrome"
      />
      {props.overlays}
    </div>
  );
}
