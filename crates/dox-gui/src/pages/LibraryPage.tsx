import { Show } from "solid-js";
import LibraryTree from "../components/features/LibraryTree";
import NoteToolbar from "../components/features/NoteToolbar";
import NoteWorkspace from "../components/features/NoteWorkspace";
import BacklinksPanel from "../components/features/BacklinksPanel";
import DiagnosticsPanel from "../components/features/DiagnosticsPanel";
import { CommandPicker, NotePicker } from "../components/features/AppPickers";
import Button from "../components/ui/Button";
import Alert from "../components/ui/Alert";
import { createLibrarySession } from "../hooks/createLibrarySession";
import AppShell from "../components/layout/AppShell";

/** The library page composes feature views around one library session. */
export default function LibraryPage() {
  const app = createLibrarySession();
  return (
    <AppShell
      sidebarVisible={app.sidebarVisible()}
      sidebarRef={app.bindSidebar}
      mainRef={app.bindMain}
      sidebar={
        <LibraryTree
          path={app.library()}
          notes={app.index().notes}
          activeId={app.current()?.note.id}
          busy={app.busy()}
          onOpen={app.openNote}
        />
      }
      header={
        <NoteToolbar
          note={app.current()?.note}
          mode={app.mode()}
          dirty={app.dirty()}
          busy={app.busy()}
          onCommand={app.executeCommand}
        />
      }
      footer={
        <footer class="flex h-[22px] shrink-0 justify-between border-t border-border px-[10px] py-1 text-[10px] text-muted">
          <span>
            {app.mode() === "edit" ? app.current()?.note.metadata.document : ""}
          </span>
          <Show when={app.lastDeleted()} fallback={<span>dox</span>}>
            <span class="flex items-center gap-2">
              Deleted {app.lastDeleted()!.id}
              <Button
                variant="link"
                size="inline"
                busy={app.busy()}
                onClick={() => app.executeCommand("undo-delete")}
              >
                Undo
              </Button>
            </span>
          </Show>
        </footer>
      }
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
      <Show
        when={!!app.current()}
        fallback={<div class="min-h-[120px] flex-1 bg-background" />}
      >
        <NoteWorkspace
          note={app.current()!.note}
          mode={app.mode()}
          source={app.source()}
          html={app.html()}
          onSourceChange={app.setSource}
          onNavigate={app.openNote}
          getNoteTitle={app.getNoteTitle}
          editorRef={app.bindEditor}
        />
        <BacklinksPanel
          notes={app.backlinks()}
          busy={app.busy()}
          onOpen={app.openNote}
        />
      </Show>
      <DiagnosticsPanel
        diagnostics={app.index().diagnostics}
        noteIds={app.index().notes.map((note) => note.id)}
        busy={app.busy()}
        onOpen={app.openIssue}
      />
    </AppShell>
  );
}
