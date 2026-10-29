import { Show } from 'solid-js';
import { bindingLabel, commandBinding, type CommandId, type UICommand } from './commands';
import { MatchText } from './ui/components/fuzzy';
import FuzzyPicker from './ui/components/FuzzyPicker';

export default function CommandPanel(props: {
  open: boolean;
  commands: UICommand[];
  onOpenChange: (open: boolean) => void;
  onSelect: (id: CommandId) => void;
}) {
  return <FuzzyPicker open={props.open} onOpenChange={props.onOpenChange}
    title="Command panel" label="Find command" listLabel="Commands" placeholder="Find command…"
    shortcut={commandBinding('commands')} emptyText="No commands found"
    items={props.commands} searchTexts={command => [command.title]}
    compare={(a, b) => a.title.localeCompare(b.title)}
    disabled={command => !command.enabled} dimDisabled selectAfterClose
    onSelect={command => props.onSelect(command.id)}
    renderItem={(command, matches) => <>
      <span class="picker-result-title"><MatchText text={command.title} positions={matches[0]?.positions ?? []}/></span>
      <Show when={command.binding}><kbd>{bindingLabel(command.binding)}</kbd></Show>
    </>}
  />;
}
