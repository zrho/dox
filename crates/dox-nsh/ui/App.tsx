import { cleanup, Text, View } from "nsh";
import { Application, currentWindow, titleBar } from "nsh/desktop";
import { AppOverlays } from "./app/AppOverlays";
import { createCommands } from "./app/commands";
import { createSession } from "./app/createSession";
import { DiagnosticsPanel } from "./app/DiagnosticsPanel";
import { bindKeybindings } from "./app/keybindings";
import { StatusBar } from "./app/StatusBar";
import { restoreAppearance } from "./design/appearance";
import { IconButton } from "./design/IconButton";
import { Workspace } from "./workspace/Workspace";

export function App() {
  const window = currentWindow();
  window.set({ titleBar: { style: "hidden", height: 28 }, closeOnPress: false });

  const session = createSession();
  const { commands, runCommand } = createCommands(session);
  const {
    activate, activeKey, canLeaveLibrary, diagnosticsOpen, index, libraryError, onEditorFocus,
    openLibrary, openNote, overlay, paneActions, panes, report, reveal, setDraft, spareKey,
    toggleEdit, watchError,
  } = session;

  const stopQuit = Application.on("quitRequest", () => {
    if (canLeaveLibrary()) Application.quit();
    else Application.cancelQuitRequest();
  });
  const stopClose = window.on("closePress", () => {
    if (canLeaveLibrary()) window.close();
  });
  Application.setQuitRequestOptions({ system: true });
  cleanup(() => { stopClose(); stopQuit(); });
  void report(restoreAppearance);
  void openLibrary(true);
  bindKeybindings(session);

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
        actions={paneActions()} onEditorFocus={onEditorFocus} />
      <DiagnosticsPanel issues={index().diagnostics} expanded={diagnosticsOpen()}
        onToggle={() => diagnosticsOpen.set(!diagnosticsOpen())} onNavigate={navigate} />
      <StatusBar state={session} onOpenCommands={() => overlay.set("commands")} />
      <AppOverlays state={session} commands={commands()} onCommand={runCommand} />
    </View>
  );
}
