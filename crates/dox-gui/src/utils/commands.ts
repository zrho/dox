import definitions from "./commands.json";

export type Keybinding = {
    key: string;
    aliases?: readonly string[];
    shift?: boolean;
    allowInTextFields?: boolean;
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
    if (!binding) return "";
    const labels: Record<string, string> = {
        escape: "Esc", arrowleft: "←", arrowright: "→",
    };
    const modifiers = `${binding.primary === false ? "" : "⌘"}${binding.shift ? "⇧" : ""}`;
    return [binding.key, ...(binding.aliases ?? [])]
        .map((key) => `${modifiers}${labels[key] ?? key.toUpperCase()}`)
        .join(" / ");
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
        event.altKey ||
        (binding.allowInTextFields === false && event.composedPath().some(
            (target) => target instanceof HTMLElement && (
                target.isContentEditable ||
                target.matches("input, textarea, select, [role=textbox], [role=combobox]")
            ),
        ))
    )
        return false;
    return (
        event.shiftKey === !!binding.shift &&
        [binding.key, ...(binding.aliases ?? [])].some((key) => key.toLowerCase() === event.key.toLowerCase())
    );
}
