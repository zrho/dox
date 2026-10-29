import { Show } from "solid-js";
import FileText from "lucide-solid/icons/file-text";
import BookOpen from "lucide-solid/icons/book-open";
export default function NoteIcon(props: { type: string; class?: string }) {
  return (
    <Show
      when={props.type === "literature"}
      fallback={
        <FileText
          size={12}
          strokeWidth={1.5}
          aria-hidden="true"
          class={props.class}
        />
      }
    >
      <BookOpen
        size={12}
        strokeWidth={1.5}
        aria-hidden="true"
        class={props.class}
      />
    </Show>
  );
}
