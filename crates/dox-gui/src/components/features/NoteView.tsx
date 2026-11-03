import DOMPurify from "dompurify";
import { baseStyles, noteSanitizeOptions, prepareNoteHtml } from "../../../../../packages/note-content/src";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import Tooltip from "../ui/Tooltip";
import { titleText, type TitledNote } from "./NoteTitle";

/** Web links leave the app; the webview never navigates away from the note. */
function openExternal(url: string) {
    void invoke<void>("open_external", { url }).catch(() => {
        window.open(url, "_blank", "noopener,noreferrer");
    });
}

export type NoteViewProps = {
    note: TitledNote;
    html: string;
    onNavigate: (id: string) => void;
    getNoteTitle: (id: string) => string | undefined;
    active?: boolean;
    zoom?: number;
};
/** Owns only the Shadow DOM, sanitized output, and delegated link interactions. */
export default function NoteView(props: NoteViewProps) {
    let host!: HTMLDivElement;
    let compiledStyles: HTMLStyleElement;
    const [hoveredLink, setHoveredLink] = createSignal<HTMLAnchorElement>();
    const [focusedLink, setFocusedLink] = createSignal<HTMLAnchorElement>();
    // Native overlay scrollbars cannot fade on a schedule that is consistent
    // across platforms, so the note draws its own thumb and hides it when idle.
    const [thumb, setThumb] = createSignal({ top: 0, height: 0 });
    const [thumbVisible, setThumbVisible] = createSignal(false);
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let resizeObserver: ResizeObserver | undefined;
    function measureScrollbar() {
        const scrollable = host.scrollHeight - host.clientHeight;
        if (scrollable <= 1 || host.clientHeight <= 0) {
            setThumb({ top: 0, height: 0 });
            setThumbVisible(false);
            return;
        }
        const height = Math.max(28, (host.clientHeight * host.clientHeight) / host.scrollHeight);
        const top = Math.max(0, Math.min(host.clientHeight - height, (host.scrollTop / scrollable) * (host.clientHeight - height)));
        setThumb({ top, height });
    }
    function revealScrollbar() {
        measureScrollbar();
        if (!thumb().height) return;
        setThumbVisible(true);
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => setThumbVisible(false), 900);
    }
    function startThumbDrag(event: PointerEvent) {
        const element = event.currentTarget as HTMLElement;
        element.setPointerCapture(event.pointerId);
        clearTimeout(idleTimer);
        const startY = event.clientY;
        const startScroll = host.scrollTop;
        const scrollable = host.scrollHeight - host.clientHeight;
        const travel = host.clientHeight - thumb().height;
        const move = (moveEvent: PointerEvent) => {
            if (travel <= 0) return;
            host.scrollTop = startScroll + ((moveEvent.clientY - startY) / travel) * scrollable;
            revealScrollbar();
        };
        const end = () => {
            element.removeEventListener("pointermove", move);
            element.removeEventListener("pointerup", end);
            element.removeEventListener("pointercancel", end);
            revealScrollbar();
        };
        element.addEventListener("pointermove", move);
        element.addEventListener("pointerup", end);
        element.addEventListener("pointercancel", end);
    }
    const tooltipAnchor = () =>
        props.active === false ? undefined : (hoveredLink() ?? focusedLink());
    const tooltipText = () => {
        const href = tooltipAnchor()?.getAttribute("href") ?? "";
        return props.getNoteTitle(href.slice(4));
    };
    const [content, setContent] = createSignal<HTMLElement>();
    onMount(() => {
        const root = host.attachShadow({ mode: "open" });
        compiledStyles = document.createElement("style");
        const defaults = document.createElement("style");
        defaults.textContent = baseStyles;
        const article = document.createElement("article");
        article.className = "note-content";
        root.append(compiledStyles, defaults, article);
        setContent(article);
        host.addEventListener("scroll", revealScrollbar, { passive: true });
        resizeObserver = new ResizeObserver(measureScrollbar);
        resizeObserver.observe(host);
        resizeObserver.observe(article);
        measureScrollbar();
        const navigate = (event: Event) => {
            const target =
                event.target instanceof Element
                    ? event.target.closest("a")
                    : null;
            if (!target) return;
            const href =
                target.getAttribute("href") ??
                target.getAttribute("xlink:href") ??
                "";
            event.preventDefault();
            if (/^dox:(?:[0-9A-Z]{5}|[0-9]{4}-[0-9]{2}-[0-9]{2})$/.test(href)) props.onNavigate(href.slice(4));
            else if (/^https?:\/\//i.test(href)) openExternal(href);
            else if (href.startsWith("#")) {
                try {
                    root.getElementById(
                        decodeURIComponent(href.slice(1)),
                    )?.scrollIntoView({ block: "start" });
                } catch {
                    /* Ignore invalid fragment encoding. */
                }
            }
        };
        const internalLink = (target: EventTarget | null) => {
            const link = target instanceof Element ? target.closest("a") : null;
            return link instanceof HTMLAnchorElement &&
                /^dox:(?:[0-9A-Z]{5}|[0-9]{4}-[0-9]{2}-[0-9]{2})$/.test(link.getAttribute("href") ?? "")
                ? link
                : undefined;
        };
        const hover = (event: Event) =>
            setHoveredLink(internalLink(event.target));
        const leave = (event: Event) =>
            setHoveredLink(
                internalLink(
                    event instanceof MouseEvent ? event.relatedTarget : null,
                ),
            );
        const focus = (event: Event) =>
            setFocusedLink(internalLink(event.target));
        const blur = (event: Event) =>
            setFocusedLink(
                internalLink(
                    event instanceof FocusEvent ? event.relatedTarget : null,
                ),
            );
        root.addEventListener("click", navigate);
        root.addEventListener("mouseover", hover);
        root.addEventListener("mouseout", leave);
        root.addEventListener("focusin", focus);
        root.addEventListener("focusout", blur);
        onCleanup(() => {
            clearTimeout(idleTimer);
            resizeObserver?.disconnect();
            host.removeEventListener("scroll", revealScrollbar);
            root.removeEventListener("click", navigate);
            root.removeEventListener("mouseover", hover);
            root.removeEventListener("mouseout", leave);
            root.removeEventListener("focusin", focus);
            root.removeEventListener("focusout", blur);
        });
    });
    // Apply zoom separately from HTML updates so selection and scroll stay intact.
    createEffect(() => {
        const article = content();
        const zoom = props.zoom ?? 100;
        article?.style.setProperty("zoom", String(zoom / 100));
        measureScrollbar();
    });
    createEffect(() => {
        const article = content();
        const html = props.html;
        if (!article) return;
        const { fragment, styles } = prepareNoteHtml(html, titleText(props.note), (input) => DOMPurify.sanitize(input, { ...noteSanitizeOptions, RETURN_DOM_FRAGMENT: true }));
        compiledStyles.textContent = styles;
        setHoveredLink(undefined);
        setFocusedLink(undefined);
        article.replaceChildren(fragment);
        host.scrollTop = 0;
        queueMicrotask(measureScrollbar);
    });
    return (
        <>
            <div class="relative h-full w-full overflow-hidden">
                <div
                    ref={host}
                    class="h-full w-full bg-document-background text-document-foreground [color-scheme:light]"
                    role="region"
                    aria-label="Rendered note"
                    tabIndex={0}
                />
                <div
                    aria-hidden="true"
                    class="absolute right-[2px] w-[5px] touch-none rounded-full bg-document-border-strong transition-opacity duration-200 motion-reduce:transition-none"
                    classList={{
                        "pointer-events-none": !thumbVisible(),
                        "opacity-0": !thumbVisible(),
                        "opacity-100": thumbVisible(),
                    }}
                    style={{
                        top: `${thumb().top}px`,
                        height: `${thumb().height}px`,
                        display: thumb().height ? undefined : "none",
                    }}
                    onPointerDown={startThumbDrag}
                />
            </div>
            <Tooltip anchor={tooltipAnchor()} text={tooltipText()} />
        </>
    );
}
