export type Keybinding = {
  key: string;
  shift?: boolean;
};
// All application commands and their shortcuts live here. A missing shortcut
// means the command is available through the command panel only.
export const commandDefinitions = [
  {
    id: "commands",
    title: "Show command panel",
    binding: { key: "p", shift: true },
  },
  { id: "find", title: "Find note", binding: { key: "p" } },
  { id: "new-note", title: "New note", binding: { key: "n" } },
  { id: "new-literature", title: "New empty literature item" },
  { id: "open-library", title: "Open library" },
  { id: "save", title: "Save note", binding: { key: "s" } },
  { id: "toggle-mode", title: "Toggle edit/view", binding: { key: "e" } },
  { id: "edit", title: "Edit source" },
  { id: "view", title: "View note" },
  { id: "insert", title: "Insert link or citation", binding: { key: "k" } },
  { id: "copy", title: "Copy note link or citation" },
  { id: "toggle-sidebar", title: "Toggle sidebar", binding: { key: "b" } },
  { id: "delete", title: "Delete note" },
  { id: "undo-delete", title: "Undo last note deletion" },
] as const satisfies readonly {
  id: string;
  title: string;
  binding?: Keybinding;
}[];
export type CommandId = (typeof commandDefinitions)[number]["id"];
export type UICommand = {
  id: CommandId;
  title: string;
  binding?: Keybinding;
  enabled: boolean;
};
export function bindingLabel(binding?: Keybinding): string {
  return binding
    ? `⌘${binding.shift ? "⇧" : ""}${binding.key.toUpperCase()}`
    : "";
}
export function commandBinding(id: CommandId): string {
  const command = commandDefinitions.find((command) => command.id === id);
  return command && "binding" in command ? bindingLabel(command.binding) : "";
}
export function matchesBinding(
  event: KeyboardEvent,
  binding?: Keybinding,
): boolean {
  return (
    !!binding &&
    !event.isComposing &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    event.shiftKey === !!binding.shift &&
    event.key.toLowerCase() === binding.key
  );
}
