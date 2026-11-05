import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/** Native file drops provide filesystem paths unavailable from browser Files. */
export function createAttachmentDrop(options: {
  enabled: () => boolean;
  targetAt: (x: number, y: number) => number | undefined;
  onDrop: (key: number, paths: string[]) => void;
  onError: (error: unknown) => void;
}) {
  const [target, setTarget] = createSignal<number>();
  createEffect(() => {
    if (!options.enabled()) setTarget(undefined);
  });
  onMount(() => {
    if (!isTauri()) return;
    const macOS = navigator.userAgent.includes("Macintosh");
    let stopped = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (stopped) return;
      if (payload.type === "leave" || !options.enabled()) {
        setTarget(undefined);
        return;
      }
      // Wry 0.57.1 sends macOS positions in AppKit points, despite Tauri
      // wrapping them as PhysicalPosition. These already match CSS pixels.
      // Read the ratio per event on other platforms to handle display changes.
      const position = macOS
        ? payload.position
        : payload.position.toLogical(window.devicePixelRatio);
      const key = options.targetAt(position.x, position.y);
      if (payload.type === "drop") {
        setTarget(undefined);
        if (key !== undefined && payload.paths.length)
          options.onDrop(key, payload.paths);
      } else {
        setTarget(key);
      }
    }).then((dispose) => {
      if (stopped) dispose();
      else unlisten = dispose;
    }).catch(options.onError);
    onCleanup(() => {
      stopped = true;
      unlisten?.();
    });
  });
  return { target };
}
