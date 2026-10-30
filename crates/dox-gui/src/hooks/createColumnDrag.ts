import { batch, createEffect, createSignal, onCleanup } from "solid-js";

type Drag = {
  key: number;
  from: number;
  to: number;
  left: number;
};
type Gesture = {
  key: number;
  pointerId: number;
  handle: HTMLElement;
  viewport: HTMLElement;
  width: number;
  order: string;
  from: number;
  startX: number;
  clientX: number;
  grabOffset: number;
};

/** Pointer capture keeps dragging continuous across editors and Shadow DOM.
 * Preview positions change during the gesture; the session order changes only
 * on drop, so every pane keeps its existing editor and scroll state. */
export function createColumnDrag(options: {
  columns: () => readonly { key: number }[];
  width: () => number;
  viewport: () => HTMLElement;
  enabled: () => boolean;
  onActivate: (key: number) => void;
  onMove: (key: number, index: number) => void;
}) {
  const [drag, setDrag] = createSignal<Drag>();
  const [interacting, setInteracting] = createSignal(false);
  let gesture: Gesture | undefined;
  let frame: number | undefined;
  let lastFrame = 0;
  const order = () => options.columns().map((column) => column.key).join(",");

  function updatePosition() {
    const current = gesture;
    if (!current || !drag()) return;
    const { left } = current.viewport.getBoundingClientRect();
    const position = current.clientX - left + current.viewport.scrollLeft - current.grabOffset;
    const maximum = (options.columns().length - 1) * current.width;
    const paneLeft = Math.max(0, Math.min(maximum, position));
    setDrag({
      key: current.key,
      from: current.from,
      to: Math.round(paneLeft / current.width),
      left: paneLeft,
    });
  }

  function autoScroll(time: number) {
    frame = undefined;
    const current = gesture;
    if (!current || !drag()) return;
    const rect = current.viewport.getBoundingClientRect();
    const edge = Math.min(56, rect.width / 4);
    const direction = current.clientX < rect.left + edge
      ? -Math.min(1, (rect.left + edge - current.clientX) / edge)
      : current.clientX > rect.right - edge
        ? Math.min(1, (current.clientX - rect.right + edge) / edge)
        : 0;
    const elapsed = lastFrame ? Math.min(time - lastFrame, 32) : 16;
    lastFrame = time;
    const previous = current.viewport.scrollLeft;
    current.viewport.scrollLeft += direction * elapsed * .7;
    if (current.viewport.scrollLeft !== previous) updatePosition();
    frame = requestAnimationFrame(autoScroll);
  }

  function finish(commit: boolean) {
    const current = gesture;
    const preview = drag();
    gesture = undefined;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    lastFrame = 0;
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", onBlur);
    current?.viewport.removeEventListener("scroll", updatePosition);
    if (current?.handle.hasPointerCapture(current.pointerId))
      current.handle.releasePointerCapture(current.pointerId);
    batch(() => {
      setInteracting(false);
      setDrag(undefined);
      if (commit && preview && preview.from !== preview.to)
        options.onMove(preview.key, preview.to);
    });
    if (commit && preview)
      queueMicrotask(() => current?.handle.focus({ preventScroll: true }));
  }

  function onKey(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey) {
      finish(false);
      return;
    }
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finish(false);
  }
  const onBlur = () => finish(false);

  function start(key: number, event: PointerEvent & { currentTarget: HTMLElement }) {
    if (!options.enabled() || event.button !== 0 || !event.isPrimary) return;
    const from = options.columns().findIndex((column) => column.key === key);
    if (from < 0) return;
    finish(false);
    const viewport = options.viewport();
    const width = options.width();
    event.preventDefault();
    gesture = {
      key,
      pointerId: event.pointerId,
      handle: event.currentTarget,
      viewport,
      width,
      order: order(),
      from,
      startX: event.clientX,
      clientX: event.clientX,
      grabOffset: event.clientX - viewport.getBoundingClientRect().left + viewport.scrollLeft - from * width,
    };
    setInteracting(true);
    event.currentTarget.focus({ preventScroll: true });
    options.onActivate(key);
    event.currentTarget.setPointerCapture(event.pointerId);
    viewport.addEventListener("scroll", updatePosition, { passive: true });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", onBlur);
  }

  function move(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    gesture.clientX = event.clientX;
    if (!drag()) {
      if (Math.abs(event.clientX - gesture.startX) < 5) return;
      setDrag({ key: gesture.key, from: gesture.from, to: gesture.from, left: gesture.from * gesture.width });
      options.onActivate(gesture.key);
      frame = requestAnimationFrame(autoScroll);
    }
    updatePosition();
  }

  // Changes to the pane geometry or an asynchronous operation cancel a gesture
  // rather than applying an outdated destination to the session.
  createEffect(() => {
    const enabled = options.enabled();
    const width = options.width();
    const keys = order();
    if (gesture && (!enabled || width !== gesture.width || keys !== gesture.order))
      finish(false);
  });
  onCleanup(() => finish(false));

  return {
    interacting,
    draggingKey: () => drag()?.key,
    start,
    move,
    end: (event: PointerEvent) => {
      if (gesture?.pointerId === event.pointerId) finish(true);
    },
    cancel: (event: PointerEvent) => {
      if (gesture?.pointerId === event.pointerId) finish(false);
    },
    left: (key: number, index: number) => {
      const preview = drag();
      if (!preview) return index * options.width();
      if (key === preview.key) return preview.left;
      let slot = index;
      if (index > preview.from && index <= preview.to) slot--;
      if (index < preview.from && index >= preview.to) slot++;
      return slot * options.width();
    },
  };
}
