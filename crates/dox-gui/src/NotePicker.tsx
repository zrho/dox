import { Show } from 'solid-js';
import { commandBinding } from './commands';
import { MatchText } from './ui/components/fuzzy';
import FuzzyPicker from './ui/components/FuzzyPicker';
import BookOpen from 'lucide-solid/icons/book-open';
import FileText from 'lucide-solid/icons/file-text';
import NoteTitle, { titleText, type TitledNote } from './NoteTitle';

type PickerNote = TitledNote & { id: string; metadata: { type: string } };
type NotePickerProps = {
  open: boolean;
  mode?: 'open' | 'insert';
  onCloseAutoFocus?: (event: Event) => void;
  notes: PickerNote[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
};

export default function NotePicker(props: NotePickerProps) {
  return <FuzzyPicker open={props.open} onOpenChange={props.onOpenChange}
    title={props.mode === 'insert' ? 'Insert link or citation' : 'Find note'}
    listLabel="Notes" placeholder={props.mode === 'insert' ? 'Link or cite…' : 'Find note…'}
    shortcut={commandBinding(props.mode === 'insert' ? 'insert' : 'find')}
    items={props.notes} busy={props.busy}
    searchTexts={note => [titleText(note), note.title, note.id]}
    compare={(a, b) => titleText(a).localeCompare(titleText(b)) || a.id.localeCompare(b.id)}
    onSelect={note => props.onSelect(note.id)} onCloseAutoFocus={props.onCloseAutoFocus}
    renderItem={(note, matches) => <>
      <Show when={note.metadata.type === 'literature'} fallback={<FileText class="note-icon" size={12} strokeWidth={1.5} aria-hidden="true"/>}><BookOpen class="note-icon" size={12} strokeWidth={1.5} aria-hidden="true"/></Show>
      <span class="picker-result-title"><NoteTitle note={note} positions={matches[0]?.positions ?? []}/></span>
      <span class="picker-result-id"><MatchText text={note.id} positions={matches[2]?.positions ?? []}/></span>
    </>}
  />;
}
