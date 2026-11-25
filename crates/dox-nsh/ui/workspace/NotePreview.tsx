import { effect, openUrl, signal, Text, WebView } from "nsh";
import { Reader } from "dox-nsh/native";
import type { WebViewRef } from "nsh/types";
import type { JSX } from "nsh/jsx-runtime";
import { appearance } from "../design/appearance";

// Match dox_core::valid_id, including calendar validation for daily notes.
function validNoteId(id: string): boolean {
    if (id.length === 5) return /^[0-9A-Z]{5}$/.test(id);
    if (id.length !== 10 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(id)) return false;
    const [year, month, day] = id.split("-").map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function externalUrl(value: string): string | undefined {
    if (value.length > 16_384 || !/^https?:\/\//i.test(value) || /[\s\x00-\x1f\x7f\\]/.test(value)) return;
    try {
        const url = new URL(value);
        if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname && !url.username && !url.password) {
            return url.href;
        }
    } catch {
        // Ignore invalid URLs from the page.
    }
}

const SHELL = Reader.previewShell();

/** Note HTML is data for the fixed shell, never the WebView's page source. */
export function NotePreview(props: {
    html: string | null;
    title: string;
    active: boolean;
    zoom: number;
    getNoteTitle: (id: string) => string | undefined;
    onActivate: () => void;
    onNote: (id: string) => void;
    onHorizontalScroll: (delta: number) => void;
}): JSX.Element {
    const failure = signal("");
    const view = signal<WebViewRef>();
    const shellReady = signal(false);
    const tooltipRequest = signal<{ id: string }>();
    let lastHtml: string | null = null;
    let lastTitle = "";

    effect(() => {
        const web = view();
        const theme = appearance();
        if (web && shellReady()) web.postMessage(JSON.stringify({ type: "set-theme", theme }));
    });

    effect(() => {
        const web = view();
        const ready = shellReady();
        const html = props.html;
        const title = props.title;
        if (!web || !ready || html === null || (html === lastHtml && title === lastTitle)) return;
        lastHtml = html;
        lastTitle = title;
        failure.set("");
        web.postMessage(JSON.stringify({ type: "render-note", html, title }));
    });

    effect(() => {
        const web = view();
        const active = props.active;
        if (web && shellReady()) web.postMessage(JSON.stringify({ type: "set-active", active }));
    });

    effect(() => {
        const web = view();
        const zoom = props.zoom;
        if (web && shellReady()) web.postMessage(JSON.stringify({ type: "set-zoom", zoom }));
    });

    // Track only the requested title, independently of note rendering and scroll.
    effect(() => {
        const web = view();
        const request = tooltipRequest();
        if (!web || !shellReady() || !request) return;
        const { id } = request;
        const title = props.getNoteTitle(id) ?? "";
        web.postMessage(JSON.stringify({ type: "set-link-title", id, title }));
    });

    function receive({ data }: { data: string }) {
        // nsh supplies a string, not an authenticated message or an origin.
        if (typeof data !== "string") return;
        if (data === "preview-ready") {
            shellReady.set(true);
            return;
        }
        if (data.startsWith("tooltip:")) {
            const id = data.slice(8);
            tooltipRequest.set(props.html !== null && validNoteId(id) ? { id } : undefined);
            return;
        }
        if (props.html === null) return;
        if (data === "render-error") {
            failure.set("Could not display the note preview.");
        } else if (data === "activate") {
            props.onActivate();
        } else if (data.startsWith("wheel-x:")) {
            const delta = Number(data.slice(8));
            if (Number.isFinite(delta) && delta !== 0) props.onHorizontalScroll(Math.max(-2000, Math.min(2000, delta)));
        } else if (data.startsWith("note:")) {
            const id = data.slice(5);
            if (validNoteId(id)) props.onNote(id);
        } else if (data.startsWith("external:")) {
            const url = externalUrl(data.slice(9));
            if (url) void openUrl(url).catch(() => { /* Do not navigate the preview. */ });
        }
    }

    return (
        <>
            {failure() && <Text>{failure()}</Text>}
            <WebView
                html={SHELL}
                incognito
                javaScriptEnabled
                style={{ flex: 1, width: "100%" }}
                ref={(node) => view.set(node)}
                onMessage={receive}
                onError={({ code }) => failure.set(
                    code === "ERR_ACCESS_DENIED" || code === "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM"
                        ? "Note preview is not available."
                        : "Could not load the note preview.",
                )}
            />
        </>
    );
}
