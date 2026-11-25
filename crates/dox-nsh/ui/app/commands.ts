import { computed } from "nsh";
import { appearance, setAppearance, themePreference } from "../design/appearance";
import type { PickerItem } from "../overlays/Picker";
import { dirty, PANE_ZOOM_STEP } from "../workspace/paneState";
import type { Session } from "./createSession";

export function createCommands(session: Session, newWindow: () => void) {
  const {
    opening, path, syncing, busy, canInsert, activePane, git, canSync, automatic,
    refreshing, activeKey, canDelete, lastDeleted, neighbor, index, overlay, openLibrary,
    findNotes, report, createNote, chooseLink, attach, findPaper, importBibtex, syncNow,
    toggleAutomaticSync, refreshIndex, toggleEdit, savePane, saveAllDrafts, copyReference, confirmReload, closePane,
    deleteNote, restoreNote, focusNeighbor, movePane, zoomPane, diagnosticsOpen,
  } = session;

  const commands = computed<PickerItem[]>(() => [
    { id: "new-window", title: "New window", detail: "⌘⇧N" },
    { id: "open", title: "Open library", detail: "⌘O", disabled: opening() },
    { id: "find", title: "Find note", detail: "⌘P", disabled: !path() || opening() || syncing() },
    { id: "new", title: "New note", detail: "⌘N", disabled: !path() || busy() },
    { id: "daily", title: "Open today’s note", detail: "⌘⇧D", disabled: !path() || busy() },
    { id: "literature", title: "New empty literature item", disabled: !path() || busy() },
    { id: "link", title: "Insert link or citation", detail: "⌘K", disabled: !canInsert() },
    { id: "link-with-title", title: "Insert link or citation with title", detail: "⌘⇧K", disabled: !canInsert() },
    { id: "copy-reference", title: "Copy link or citation", disabled: !activePane()?.note },
    { id: "attach", title: "Attach files to item", disabled: !activePane()?.note || busy() },
    { id: "pdf", title: "Find and attach paper PDF", disabled: activePane()?.note?.entry.kind !== "literature" || busy() },
    { id: "publication", title: "Import publication from link or tag", disabled: !path() || busy() },
    { id: "bibtex", title: "Import literature from BibTeX file…", disabled: !path() || busy() },
    { id: "sync", title: "Sync now", disabled: !git() || !canSync() },
    { id: "auto-sync", title: automatic() ? "Disable automatic sync" : "Enable automatic sync", disabled: busy() || (!automatic() && !git()?.upstream) },
    { id: "refresh", title: "Refresh library index", disabled: !path() || refreshing() || busy() },
    { id: "edit", title: activePane()?.editing ? "Save and view note" : "Edit source", detail: "E", disabled: !activePane()?.note || activePane()?.updating || activePane()?.saving },
    { id: "save", title: "Save note", detail: "⌘S", disabled: busy() || !activePane()?.editing || activePane()?.saving || !dirty(activePane()) },
    { id: "save-all", title: "Save all drafts", disabled: busy() || !session.panes().some((pane) => dirty(pane) && !pane.saving && !pane.updating) },
    { id: "reload", title: "Reload focused note from disk", disabled: !activePane() || activePane()?.saving || activePane()?.updating },
    { id: "close", title: "Close focused pane", detail: "⌘W", disabled: activeKey() === null },
    { id: "delete", title: "Delete note", detail: "D", disabled: !canDelete() },
    { id: "restore", title: "Undo last note deletion", disabled: !lastDeleted() || busy() },
    { id: "previous", title: "Focus previous pane", detail: "J / ←", disabled: neighbor(-1) === undefined },
    { id: "next", title: "Focus next pane", detail: "K / →", disabled: neighbor(1) === undefined },
    { id: "move-left", title: "Move pane left", detail: "⇧J / ⇧←", disabled: neighbor(-1) === undefined },
    { id: "move-right", title: "Move pane right", detail: "⇧K / ⇧→", disabled: neighbor(1) === undefined },
    { id: "zoom-out", title: "Zoom out", detail: "⌘−", disabled: !activePane()?.note },
    { id: "zoom-in", title: "Zoom in", detail: "⌘+", disabled: !activePane()?.note },
    { id: "zoom-reset", title: "Reset zoom", detail: "⌘0", disabled: !activePane()?.note },
    { id: "diagnostics", title: "Toggle library diagnostics", disabled: !index().diagnostics.length },
    { id: "toggle-theme", title: `Theme: Switch to ${appearance() === "dark" ? "light" : "dark"} mode` },
    { id: "system-theme", title: "Theme: Follow system appearance", disabled: themePreference() === undefined },
  ]);

  function runCommand(id: string) {
    overlay.set(null);
    switch (id) {
      case "new-window": void report(async () => newWindow()); break;
      case "open": void openLibrary(); break;
      case "find": findNotes(); break;
      case "new": void report(() => createNote("note")); break;
      case "daily": void report(() => createNote("daily")); break;
      case "literature": void report(() => createNote("literature")); break;
      case "link": chooseLink(); break;
      case "link-with-title": chooseLink(true); break;
      case "copy-reference": void report(copyReference); break;
      case "attach": { const key = activeKey(); if (key !== null) void report(() => attach(key)); break; }
      case "pdf": {
        const pane = activePane();
        if (pane?.note?.entry.kind === "literature") void report(() => findPaper(pane));
        break;
      }
      case "publication": overlay.set("publication"); break;
      case "bibtex": void report(importBibtex); break;
      case "sync": void report(syncNow); break;
      case "auto-sync": void report(toggleAutomaticSync); break;
      case "refresh": void refreshIndex(); break;
      case "edit": toggleEdit(); break;
      case "save": { const key = activeKey(); if (key !== null) void savePane(key, false); break; }
      case "save-all": void report(saveAllDrafts); break;
      case "reload": void confirmReload(); break;
      case "close": void closePane(); break;
      case "delete": void report(deleteNote); break;
      case "restore": void report(restoreNote); break;
      case "previous": focusNeighbor(-1); break;
      case "next": focusNeighbor(1); break;
      case "move-left": movePane(-1); break;
      case "move-right": movePane(1); break;
      case "zoom-out": zoomPane(-PANE_ZOOM_STEP); break;
      case "zoom-in": zoomPane(PANE_ZOOM_STEP); break;
      case "zoom-reset": zoomPane("reset"); break;
      case "diagnostics": diagnosticsOpen.set(!diagnosticsOpen()); break;
      case "toggle-theme": void report(() => setAppearance(appearance() === "dark" ? "light" : "dark")); break;
      case "system-theme": void report(() => setAppearance(undefined)); break;
    }
  }

  return { commands, runCommand };
}
