import { Show } from "solid-js";
import { isTauri } from "@tauri-apps/api/core";
import NoteToolbar from "../components/features/NoteToolbar";
import LibraryWorkspace from "../components/features/LibraryWorkspace";
import DiagnosticsPanel from "../components/features/DiagnosticsPanel";
import PublicationImportDialog from "../components/features/PublicationImportDialog";
import { CommandPicker, NotePicker } from "../components/features/AppPickers";
import Button from "../components/ui/Button";
import Alert from "../components/ui/Alert";
import { createLibrarySession } from "../hooks/createLibrarySession";
import AppShell from "../components/layout/AppShell";

/** Split a library path so the folder name stays visible while the prefix truncates. */
function splitLibraryPath(path: string) {
  const trimmed = path.replace(/\/+$/, "");
  const index = trimmed.lastIndexOf("/");
  return index > 0
    ? { parent: trimmed.slice(0, index + 1), name: trimmed.slice(index + 1) }
    : { parent: "", name: trimmed };
}

/** The library page composes feature views around one library session. */
export default function LibraryPage() {
  const app = createLibrarySession();
  const nativeTitlebar = isTauri() && navigator.userAgent.includes("Macintosh");
  return (
    <AppShell
      titlebar={nativeTitlebar}
      mainRef={app.bindMain}
      status={
        <>
          <Show when={app.exportStatus()}><span class="min-w-0 truncate" title={app.exportStatus()}>{app.exportStatus()}</span></Show>
          <Show when={app.library()}>
            {(path) => {
              const parts = splitLibraryPath(path());
              return (
                <span class="flex min-w-0 items-baseline" title={path()}>
                  <span class="min-w-0 truncate text-subtle">{parts.parent}</span>
                  <span class="shrink-0">{parts.name}</span>
                </span>
              );
            }}
          </Show>
          <Show when={app.library()}>
            <button type="button" class="shrink-0 text-muted hover:text-foreground" onClick={app.showGitChanges}
              title="Show library changes">
              {app.git.statusLabel()}
            </button>
          </Show>
        </>
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
      <LibraryWorkspace app={app} />
      <DiagnosticsPanel
        diagnostics={app.index().diagnostics}
        noteIds={app.index().notes.map((note) => note.id)}
        busy={app.busy()}
        onOpen={app.openIssue}
      />
    </AppShell>
  );
}
