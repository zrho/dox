import { onMount, onCleanup } from "solid-js";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  commandDefinitions,
  matchesBinding,
  type CommandId,
} from "../utils/commands";
/** Owns native subscriptions and browser event cleanup; no document mutations. */
export function createDesktopLifecycle(options: {
  dirty: () => boolean;
  busy: () => boolean;
  modalOpen: () => boolean;
  editorFocused: () => boolean;
  onChange: () => Promise<void>;
  onCommand: (id: CommandId) => void;
  onRestoreLibrary: (path: string) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  onMount(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let unlisten: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested((event) => {
        if (
          options.dirty() &&
          !window.confirm("Discard unsaved drafts and close dox?")
        )
          event.preventDefault();
      })
      .then((fn) => {
        if (stopped) fn();
        else unlistenClose = fn;
      })
      .catch(options.onError);
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (options.busy()) {
          changed();
          return;
        }
        void options.onChange();
      }, 350);
    };
    listen("library-changed", changed)
      .then((fn) => {
        if (stopped) fn();
        else unlisten = fn;
      })
      .catch(options.onError);
    const onKey = (event: KeyboardEvent) => {
      const command = commandDefinitions.find((command) =>
        matchesBinding(
          event,
          "binding" in command ? command.binding : undefined,
        ),
      );
      if (!command) return;
      event.preventDefault();
      if (
        options.modalOpen() ||
        (command.id === "insert" && !options.editorFocused())
      )
        return;
      options.onCommand(command.id);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (options.dirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", beforeUnload);
    const last = localStorage.getItem("dox.library");
    if (last) void options.onRestoreLibrary(last);
    onCleanup(() => {
      stopped = true;
      clearTimeout(timer);
      unlisten?.();
      unlistenClose?.();
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", beforeUnload);
    });
  });
}
