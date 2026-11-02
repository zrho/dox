import { onMount, onCleanup } from "solid-js";
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
  dismissMessage: () => boolean;
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
          !window.confirm("Discard unsaved drafts and close this window?")
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
    getCurrentWindow().listen("library-changed", changed)
      .then((fn) => {
        if (stopped) fn();
        else unlisten = fn;
      })
      .catch(options.onError);
    const escapeBinding = commandDefinitions.find((command) => command.id === "escape")?.binding;
    const onKeyCapture = (event: KeyboardEvent) => {
      if (event.defaultPrevented || options.modalOpen() || !matchesBinding(event, escapeBinding)) return;
      // Messages have priority even when focus is inside a disclosure or editor.
      // Held Escape must not dismiss one thing and then close another.
      if (event.repeat || options.dismissMessage()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      // Nested controls get the first chance to dismiss themselves.
      if (event.defaultPrevented || options.modalOpen()) return;
      const command = commandDefinitions.find((command) =>
        matchesBinding(
          event,
          "binding" in command ? command.binding : undefined,
        ),
      );
      if (!command) return;
      event.preventDefault();
      if (
        ((command.id === "close" || command.id === "escape" || command.id === "delete") && event.repeat) ||
        ((command.id === "insert" || command.id === "insert-with-title") &&
          !options.editorFocused())
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
    window.addEventListener("keydown", onKeyCapture, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", beforeUnload);
    const last = localStorage.getItem("dox.library");
    if (last) void options.onRestoreLibrary(last);
    onCleanup(() => {
      stopped = true;
      clearTimeout(timer);
      unlisten?.();
      unlistenClose?.();
      window.removeEventListener("keydown", onKeyCapture, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", beforeUnload);
    });
  });
}
