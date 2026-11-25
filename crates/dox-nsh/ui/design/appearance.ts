import { colorScheme, setColorScheme, signal, Storage } from "nsh";

type Appearance = "light" | "dark";
const key = "dox.theme";
const preference = signal<Appearance>();
let changes = 0;

export const appearance = colorScheme;
export const themePreference = () => preference();

function apply(theme: Appearance | undefined) {
  setColorScheme(theme ?? "system");
  preference.set(theme);
}

export async function restoreAppearance() {
  const version = changes;
  const stored = await Storage.getItem(key);
  if (version === changes && (stored === "light" || stored === "dark")) apply(stored);
}

export async function setAppearance(theme: Appearance | undefined) {
  changes++;
  apply(theme);
  if (theme === undefined) await Storage.removeItem(key);
  else await Storage.setItem(key, theme);
}
