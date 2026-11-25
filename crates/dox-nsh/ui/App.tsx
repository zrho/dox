import { cleanup, Text, View } from "nsh";
import { Application, currentWindow, titleBar } from "nsh/desktop";
import { installApplicationMenu } from "./app/applicationMenu";
import { AppOverlays } from "./app/AppOverlays";
import { createCommands } from "./app/commands";
import { createSession } from "./app/createSession";
import { DiagnosticsPanel } from "./app/DiagnosticsPanel";
import { canQuit, openWorkspace, registerSession } from "./app/windowSessions";
import { bindKeybindings } from "./app/keybindings";
import { StatusBar } from "./app/StatusBar";
import { restoreAppearance } from "./design/appearance";
import { IconButton } from "./design/IconButton";
import { Workspace } from "./workspace/Workspace";

export function App() {
  const stopQuit = Application.on("quitRequest", () => {
    if (canQuit()) Application.quit();
    else Application.cancelQuitRequest();
  });
  Application.setQuitRequestOptions({ system: true });
  cleanup(stopQuit);
  cleanup(installApplicationMenu(newWindow));
  return <WorkspaceWindow />;
}

function newWindow() {
  openWorkspace(WorkspaceWindow);
}

function WorkspaceWindow() {
  const window = currentWindow();
  window.set({ title: "Dox", titleBar: { style: "hidden", height: 28 }, closeOnPress: false });

  const session = createSession(window.id);
  const { commands, runCommand } = createCommands(session, newWindow);
  cleanup(registerSession(session));
  const {
    activate, activeKey, canLeaveLibrary, diagnosticsOpen, index, libraryError, onEditorFocus,
    openLibrary, openNote, overlay, paneActions, panes, reorderPane, report, reveal, setDraft, spareKey,
    toggleEdit, watchError,
  } = session;

  const stopClose = window.on("closePress", () => {
    if (!canLeaveLibrary()) return;
    // The NSH macOS host exits when its main window closes. Keep it available for Dock reopen.
    if (window.main) window.hide();
    else window.close();
  });
  cleanup(stopClose);
  if (window.main) void report(restoreAppearance);
  void openLibrary(true);
  bindKeybindings(session, newWindow);

  const navigate = (id: string) => void openNote(id);
  return (
    <View class="flex-1 bg-background">
      <View desktop={{ windowDrag: true }} style={{ height: titleBar().height }} class="shrink-0 border-b border-border bg-muted" />
      <If when={libraryError()}>
        <View class="flex-row items-center border-b border-border px-2 py-1">
          <Text class="flex-1 text-xs text-foreground">{libraryError()}</Text>
          <IconButton icon="close" label="Dismiss message" onPress={() => libraryError.set("")} />
        </View>
      </If>
      <If when={watchError()}><Text class="border-b border-border px-2 py-1 text-xs text-muted-foreground">{watchError()}</Text></If>
      <Workspace panes={panes()} spareKey={spareKey()} activeKey={activeKey()} reveal={reveal()} entries={index().entries}
        onActivate={activate} onNavigate={navigate} onEdit={toggleEdit} onDraft={setDraft}
        actions={paneActions()} onReorder={reorderPane} onEditorFocus={onEditorFocus} />
      <DiagnosticsPanel issues={index().diagnostics} expanded={diagnosticsOpen()}
        entries={index().entries} busy={session.busy()}
        onToggle={() => diagnosticsOpen.set(!diagnosticsOpen())} onOpen={(issue) => void session.openDiagnostic(issue)} />
      <StatusBar state={session} onOpenCommands={() => overlay.set("commands")} />
      <AppOverlays state={session} commands={commands()} onCommand={runCommand} />
    </View>
  );
}
