import { cleanup, effect, keymap } from "nsh";
import { PANE_ZOOM_STEP } from "../workspace/paneState";
import type { Session } from "./createSession";

export function bindKeybindings(session: Session, newWindow: () => void) {
  const {
    overlay, openLibrary, path, busy, report, createNote, chooseLink, findNotes, confirming,
    operation, activeKey, libraryError, activePane, toggleEdit, closePane, savePane,
    editorFocused, deleteNote, focusNeighbor, movePane, zoomPane,
  } = session;

  cleanup(keymap.bind({
    "mod+o": () => { if (!overlay()) void openLibrary(); },
    "mod+shift+n": () => { if (!overlay()) void report(async () => newWindow()); },
    "mod+n": () => { if (path() && !busy() && !overlay()) void report(() => createNote("note")); },
    "mod+shift+d": () => { if (path() && !busy() && !overlay()) void report(() => createNote("daily")); },
    "mod+k": () => { if (!overlay()) chooseLink(); },
    "mod+minus": () => { if (!overlay()) zoomPane(-PANE_ZOOM_STEP); },
    "mod+plus": () => { if (!overlay()) zoomPane(PANE_ZOOM_STEP); },
    "mod+shift+plus": () => { if (!overlay()) zoomPane(PANE_ZOOM_STEP); },
    "mod+0": () => { if (!overlay()) zoomPane("reset"); },
    "mod+shift+k": () => { if (!overlay()) chooseLink(true); },
    "mod+p": () => { if (overlay() === "notes") overlay.set(null); else if (!overlay()) findNotes(); },
    "mod+shift+p": () => { if (overlay() === "commands") overlay.set(null); else if (!overlay()) overlay.set("commands"); },
  }, { when: "always" }));
  effect(() => {
    if (overlay() || confirming() || operation() || (activeKey() === null && !libraryError())) return;
    return keymap.bind({
      escape: () => {
        if (libraryError()) libraryError.set("");
        else if (activePane()?.editing) toggleEdit();
        else void closePane();
      },
      "mod+w": () => void closePane(),
      "mod+s": () => { const key = activeKey(); if (key !== null) void savePane(key, false); },
    }, { when: "always" });
  });
  effect(() => {
    if (overlay() || confirming() || activeKey() === null || editorFocused() !== null) return;
    return keymap.bind({
      e: () => toggleEdit(),
      d: () => void report(deleteNote),
      j: () => focusNeighbor(-1), left: () => focusNeighbor(-1),
      k: () => focusNeighbor(1), right: () => focusNeighbor(1),
      "shift+j": () => movePane(-1), "shift+left": () => movePane(-1),
      "shift+k": () => movePane(1), "shift+right": () => movePane(1),
    }, { when: "always" });
  });
}
