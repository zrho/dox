import { createEffect, createSignal, For, onCleanup, onMount, type JSX } from "solid-js";
import { createColumnDrag } from "../../hooks/createColumnDrag";
import WorkspacePaneFrame from "./WorkspacePaneFrame";

const MAX_WIDTH = 520;
const MIN_WIDTH = 280;

/** Horizontal layout depends only on stable pane keys, never on their content. */
export default function WorkspacePanes<T extends { key: number }>(props: {
  panes: T[];
  activeKey?: number;
  revealRequest: number;
  busy: boolean;
  label: (pane: T) => string;
  onActivate: (key: number) => void;
  onMove: (key: number, index: number) => void;
  bindFrame: (key: number, element: HTMLElement) => void;
  unbindFrame: (key: number) => void;
  viewportRef: (element: HTMLDivElement) => void;
  onInteractionChange: (interacting: boolean) => void;
  children: (pane: T) => JSX.Element;
}) {
  let viewport!: HTMLDivElement;
  const [availableWidth, setAvailableWidth] = createSignal(MAX_WIDTH);
  onMount(() => {
    props.viewportRef(viewport);
    setAvailableWidth(viewport.clientWidth);
    const observer = new ResizeObserver((entries) =>
      setAvailableWidth(entries[0].contentRect.width),
    );
    observer.observe(viewport);
    onCleanup(() => observer.disconnect());
  });
  const paneWidth = () => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, availableWidth()));
  const drag = createColumnDrag({
    columns: () => props.panes,
    width: paneWidth,
    viewport: () => viewport,
    enabled: () => !props.busy,
    onActivate: props.onActivate,
    onMove: props.onMove,
  });
  createEffect(() => props.onInteractionChange(drag.interacting()));
  let revealRequest = 0;
  createEffect(() => {
    const index = props.panes.findIndex((pane) => pane.key === props.activeKey);
    const width = paneWidth();
    const explicitRequest = props.revealRequest;
    const request = ++revealRequest;
    if (drag.interacting() || index < 0) return;
    queueMicrotask(() => {
      if (request !== revealRequest || explicitRequest !== props.revealRequest || !viewport) return;
      const left = index * width;
      const right = left + width;
      if (left < viewport.scrollLeft) viewport.scrollLeft = left;
      else if (right > viewport.scrollLeft + viewport.clientWidth)
        viewport.scrollLeft = right - viewport.clientWidth;
    });
  });
  function preventFileDropDefault(event: DragEvent) {
    // Native file handling belongs to the content adapter. Never navigate away.
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  }
  return (
    <div
      ref={viewport}
      class="relative min-h-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain bg-panel [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      classList={{ "select-none": drag.draggingKey() !== undefined }}
      aria-label="Workspace panes"
      onDragOver={preventFileDropDefault}
      onDrop={preventFileDropDefault}
    >
      <div class="relative mx-auto h-full" style={{ width: `${props.panes.length * paneWidth()}px` }}>
        <For each={props.panes}>
          {(pane, index) => (
            <WorkspacePaneFrame
              paneKey={pane.key}
              label={props.label(pane)}
              width={paneWidth()}
              left={drag.left(pane.key, index())}
              dragging={drag.draggingKey() === pane.key}
              trailing={drag.left(pane.key, index()) === (props.panes.length - 1) * paneWidth()}
              active={props.activeKey === pane.key}
              busy={props.busy}
              onActivate={() => props.onActivate(pane.key)}
              onDragStart={(event) => drag.start(pane.key, event)}
              onDragMove={drag.move}
              onDragEnd={drag.end}
              onDragCancel={drag.cancel}
              bindFrame={(element) => props.bindFrame(pane.key, element)}
              unbindFrame={() => props.unbindFrame(pane.key)}
            >
              {props.children(pane)}
            </WorkspacePaneFrame>
          )}
        </For>
      </div>
    </div>
  );
}
