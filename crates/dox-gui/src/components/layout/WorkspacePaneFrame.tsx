import { onCleanup, type JSX } from "solid-js";

/** Content-independent chrome, activation, and drag handle for a workspace pane. */
export default function WorkspacePaneFrame(props: {
  paneKey: number;
  label: string;
  width: number;
  left: number;
  dragging: boolean;
  active: boolean;
  busy: boolean;
  onActivate: () => void;
  onDragStart: (event: PointerEvent & { currentTarget: HTMLButtonElement }) => void;
  onDragMove: (event: PointerEvent) => void;
  onDragEnd: (event: PointerEvent) => void;
  onDragCancel: (event: PointerEvent) => void;
  bindFrame: (element: HTMLElement) => void;
  unbindFrame: () => void;
  children: JSX.Element;
}) {
  let pointerDown = false;
  onCleanup(props.unbindFrame);
  return (
    <section
      ref={props.bindFrame}
      tabIndex={-1}
      data-workspace-pane-key={props.paneKey}
      class="absolute top-0 left-0 flex h-full flex-col border-r border-border bg-background outline-none motion-safe:transition-[transform,box-shadow] motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.2,0.8,0.2,1)]"
      classList={{
        "z-10": props.dragging,
        "shadow-lg": props.dragging,
        "shadow-overlay/25": props.dragging,
        "will-change-transform": props.dragging,
      }}
      style={{
        width: `${props.width}px`,
        transform: `translateX(${props.left}px)`,
        transition: props.dragging ? "none" : undefined,
      }}
      aria-label={props.label}
      onPointerDown={(event) => {
        pointerDown = true;
        if (props.busy && !props.active) event.preventDefault();
      }}
      onPointerUp={() => { pointerDown = false; }}
      onPointerCancel={() => { pointerDown = false; }}
      onLostPointerCapture={() => { pointerDown = false; }}
      onClick={props.onActivate}
      onFocusIn={() => {
        if (!pointerDown) props.onActivate();
      }}
    >
      <div class="group shrink-0 select-none">
        <div
          aria-hidden="true"
          class="h-[2px] transition-colors motion-reduce:transition-none"
          classList={{ "bg-accent": props.active, "bg-border": !props.active }}
        />
        <header class="flex h-2 items-stretch">
          <button
            type="button"
            class="min-w-0 flex-1 touch-none self-stretch select-none outline-none"
            classList={{ "cursor-grab": !props.dragging, "cursor-grabbing": props.dragging }}
            onPointerDown={props.onDragStart}
            onPointerMove={props.onDragMove}
            onPointerUp={props.onDragEnd}
            onPointerCancel={props.onDragCancel}
            onLostPointerCapture={props.onDragCancel}
            onClick={props.onActivate}
            aria-label={`Drag ${props.label} to reorder`}
          >
            <span
              aria-hidden="true"
              class="pointer-events-none mx-auto my-[3px] block h-[2px] w-6 rounded-full bg-border-strong opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
            />
          </button>
        </header>
      </div>
      {props.children}
    </section>
  );
}
