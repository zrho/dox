import { createSignal, Show } from "solid-js";
import WorkspacePanes from "../layout/WorkspacePanes";
import NotePaneContent from "./NotePaneContent";
import { titleText } from "./NoteTitle";
import { createAttachmentDrop } from "../../hooks/createAttachmentDrop";
import type { LibrarySession } from "../../hooks/createLibrarySession";
import { isNotePane, type WorkspacePane } from "../../types";

/** Connect library content to the content-independent workspace layout. */
export default function LibraryWorkspace(props: { app: LibrarySession }) {
  const app = props.app;
  let viewport: HTMLDivElement | undefined;
  const [interacting, setInteracting] = createSignal(false);
  const fileDrop = createAttachmentDrop({
    enabled: () => !app.busy() && !interacting(),
    targetAt: (x, y) => {
      const frame = document.elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-workspace-pane-key]");
      if (!frame || !viewport?.contains(frame)) return;
      const key = Number(frame.dataset.workspacePaneKey);
      const pane = app.panes().find((pane) => pane.key === key);
      return pane && isNotePane(pane) ? key : undefined;
    },
    onDrop: (key, paths) => {
      const pane = app.panes().find((pane) => pane.key === key);
      if (!pane || !isNotePane(pane)) return;
      app.activatePane(key);
      app.attachFiles(pane.document.note.id, paths);
    },
    onError: app.reportError,
  });
  function paneLabel(pane: WorkspacePane) {
    if (isNotePane(pane)) {
      return `${titleText(pane.document.note)}${app.notePaneDirty(pane) ? " (unsaved)" : ""}`;
    }
    return "Workspace pane";
  }
  return (
    <WorkspacePanes
      panes={app.panes()}
      activeKey={app.activeKey()}
      revealRequest={app.paneReveal()}
      busy={app.busy()}
      label={paneLabel}
      onActivate={app.activatePane}
      onMove={app.movePane}
      bindFrame={app.bindPaneFrame}
      unbindFrame={app.unbindPaneFrame}
      viewportRef={(element) => { viewport = element; }}
      onInteractionChange={setInteracting}
    >
      {(pane) => (
        <Show when={isNotePane(pane) ? pane : undefined}>
          {(notePane) => (
            <NotePaneContent
              pane={notePane()}
              active={app.activeKey() === pane.key}
              busy={app.busy()}
              dropTarget={fileDrop.target() === pane.key}
              notes={app.index().notes}
              onAttach={() => app.attachFiles(notePane().document.note.id)}
              onOpenAttachment={(name) => app.openAttachment(notePane().document.note.id, name)}
              onRemoveAttachment={(name) => app.removeAttachment(notePane().document.note.id, name)}
              onNavigate={(id) => app.openLinked(id, pane.key)}
              onSourceChange={(source) => app.setNoteSource(pane.key, source)}
              getNoteTitle={app.getNoteTitle}
              editorRef={(element) => app.bindEditor(pane.key, element)}
              onDispose={() => app.unbindEditor(pane.key)}
            />
          )}
        </Show>
      )}
    </WorkspacePanes>
  );
}
