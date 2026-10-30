import definitions from "./commands.json";

export type Keybinding = {
    key: string;
    shift?: boolean;
    /** Command on macOS or Control elsewhere; required unless explicitly false. */
    primary?: boolean;
};
// commands.json is shared with the native menu. A missing shortcut means the
// command is available through the command panel only.
export type CommandId = keyof typeof definitions;
export const commandDefinitions = (
    Object.entries(definitions) as [CommandId, { title: string; binding?: Keybinding }][]
).map(([id, definition]) => ({ id, ...definition }));
export type UICommand = {
    id: CommandId;
    title: string;
    binding?: Keybinding;
    enabled: boolean;
};
export function bindingLabel(binding?: Keybinding): string {
    return binding
        ? `${binding.primary === false ? "" : "⌘"}${binding.shift ? "⇧" : ""}${binding.key === "escape" ? "Esc" : binding.key.toUpperCase()}`
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
    if (
        !binding ||
        event.isComposing ||
        (event.metaKey || event.ctrlKey) !== (binding.primary !== false) ||
        event.altKey
    )
        return false;
    return (
        event.shiftKey === !!binding.shift &&
        event.key.toLowerCase() === binding.key
    );
}
