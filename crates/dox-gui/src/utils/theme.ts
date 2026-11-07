type Theme = "light" | "dark";

const storageKey = "dox.theme";
let preference: Theme | undefined;

function parseTheme(value: string | null): Theme | undefined {
    return value === "light" || value === "dark" ? value : undefined;
}

function applyTheme() {
    document.documentElement.dataset.theme = preference ??
        (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

/** Apply before rendering; explicit choices override subsequent OS changes. */
export function initializeTheme() {
    try {
        preference = parseTheme(localStorage.getItem(storageKey));
    } catch {
        preference = undefined;
    }
    applyTheme();
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
        if (!preference) applyTheme();
    };
    const onStorage = (event: StorageEvent) => {
        if (event.key !== storageKey && event.key !== null) return;
        try {
            if (event.storageArea !== localStorage) return;
        } catch {
            return;
        }
        preference = parseTheme(event.newValue);
        applyTheme();
    };
    systemTheme.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    return () => {
        systemTheme.removeEventListener("change", onSystemChange);
        window.removeEventListener("storage", onStorage);
    };
}

export function toggleTheme() {
    preference = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme();
    try {
        localStorage.setItem(storageKey, preference);
    } catch {
        // Keep the choice for this window when persistence is unavailable.
    }
}
