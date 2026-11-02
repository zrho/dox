export default function NoteToolbar(props: { titlebar?: boolean }) {
  return (
    <header
      data-tauri-drag-region={props.titlebar ? "" : undefined}
      class="h-7 shrink-0 border-b border-border bg-chrome"
      classList={{ "select-none": props.titlebar }}
    />
  );
}
