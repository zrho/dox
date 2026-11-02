import { Show } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import LibraryTree from "../components/features/LibraryTree";
import NoteToolbar from "../components/features/NoteToolbar";
import NoteColumns from "../components/features/NoteColumns";
import DiagnosticsPanel from "../components/features/DiagnosticsPanel";
import PublicationImportDialog from "../components/features/PublicationImportDialog";
import { CommandPicker, NotePicker } from "../components/features/AppPickers";
import Button from "../components/ui/Button";
import Alert from "../components/ui/Alert";
import { createLibrarySession } from "../hooks/createLibrarySession";
import AppShell from "../components/layout/AppShell";

/** The library page composes feature views around one library session. */
export default function LibraryPage() {
  const app = createLibrarySession();
  const nativeTitlebar = isTauri() && navigator.userAgent.includes("Macintosh");
  return (
    <AppShell
      titlebar={nativeTitlebar}
      sidebarVisible={app.sidebarVisible()}
      sidebarRef={app.bindSidebar}
      mainRef={app.bindMain}
      sidebar={
        <LibraryTree
          path={app.library()}
          notes={app.pinnedNotes()}
          activeId={app.current()?.note.id}
          busy={app.busy()}
          onOpen={app.openNote}
        />
      }
      header={<NoteToolbar titlebar={nativeTitlebar} />}
      overlays={
        <>
          {" "}
          <CommandPicker
            open={app.commandPanelOpen()}
            onOpenChange={app.setCommandPanelOpen}
            commands={app.commands()}
            onSelect={app.executeCommand}
          />
          <NotePicker
            open={app.pickerOpen()}
            onOpenChange={app.setPickerOpen}
            notes={app.index().notes}
            busy={app.busy()}
            mode={app.pickerMode()}
            onSelect={app.selectNote}
            onCloseAutoFocus={app.pickerCloseFocus}
          />
          <PublicationImportDialog
            open={app.publicationImportOpen()}
            onOpenChange={app.setPublicationImportOpen}
            onImport={app.importPublication}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              queueMicrotask(app.focusActive);
            }}
          />
        </>
      }
    >
      <Show when={app.error()}>
        <Alert variant="error" onDismiss={app.dismissError}>
          <pre class="m-0 whitespace-pre-wrap font-mono text-[11px] leading-[1.5]">
            {app.error()}
          </pre>
        </Alert>
      </Show>
      <Show when={app.warning()}>
        <Alert variant="warning" onDismiss={app.dismissWarning}>
          <p class="m-0 whitespace-pre-wrap">{app.warning()}</p>
        </Alert>
      </Show>
      <Show when={app.external()}>
        <Alert
          actions={
            <Button size="small" onClick={app.reload}>
              Reload from disk
            </Button>
          }
        >
          This note changed on disk. Your draft is preserved.
        </Alert>
      </Show>
      <NoteColumns
        columns={app.columns()}
        activeKey={app.activeKey()}
        revealRequest={app.columnReveal()}
        notes={app.index().notes}
        busy={app.busy()}
        onActivate={app.activateColumn}
        onMove={app.moveColumn}
        onAttach={app.attachFiles}
        onDropFiles={app.attachFiles}
        onError={app.reportError}
        onOpenAttachment={app.openAttachment}
        onRemoveAttachment={app.removeAttachment}
        onNavigate={app.openLinked}
        onSourceChange={app.setColumnSource}
        getNoteTitle={app.getNoteTitle}
        bindEditor={app.bindEditor}
        unbindEditor={app.unbindEditor}
      />
      <DiagnosticsPanel
        diagnostics={app.index().diagnostics}
        noteIds={app.index().notes.map((note) => note.id)}
        busy={app.busy()}
        onOpen={app.openIssue}
      />
    </AppShell>
  );
}
