import DOMPurify from "dompurify";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import Tooltip from "../ui/Tooltip";

const baseStyles = `
:host{display:block;height:100%;min-height:0;overflow:auto;overscroll-behavior-y:none;background:var(--color-document-background);color:var(--color-document-foreground);color-scheme:light;contain:layout paint style;outline:none}
*{overscroll-behavior-y:none}
.note-content{box-sizing:border-box;margin:0;padding:10px 12px;font:16px/1.5 "Palatino",serif;overflow-wrap:break-word;text-wrap:balance}
h1,h2,h3{line-height:1.25;color:var(--color-document-foreground);margin:.65em 0 .35em}
h1{font-size:24px;letter-spacing:-.3px}h2{font-size:20px}h3{font-size:17px}
p{margin:.5em 0}.note-content>:first-child{margin-top:0}
ul,ol{margin:.4em 0;padding-inline-start:1.5em;list-style-position:outside}
ul{list-style-type:disc}ul ul{list-style-type:circle}ul ul ul{list-style-type:square}
ol{list-style-type:decimal}ol ol{list-style-type:lower-alpha}ol ol ol{list-style-type:lower-roman}
li{padding-inline-start:.2em}li+li{margin-top:.1em}
li::marker{color:var(--color-document-muted);font-variant-numeric:tabular-nums}
li>p{margin:.1em 0}li>:first-child{margin-top:0}li>:last-child{margin-bottom:0}
li>ul,li>ol{margin-top:.1em;margin-bottom:0}
dl{margin:.4em 0}dt{margin-top:.3em;font-weight:600}dd{margin:.1em 0 .3em 1.5em}dd>p{margin:.1em 0}
.literature-fields{width:100%;max-width:840px;border-collapse:collapse;font-size:14px;line-height:1.45;text-align:left;margin-top:12px}
.literature-fields th,.literature-fields td{padding:4px 10px;border-bottom:1px solid var(--color-document-border);vertical-align:top}
.literature-fields tr:first-child>*{border-top:1px solid var(--color-document-border)}
.literature-fields th{width:140px;padding-left:0;color:var(--color-document-muted);font:500 9px/18px var(--font-sans);letter-spacing:1px;text-transform:uppercase;text-align:right;vertical-align:middle}
.literature-fields td{color:var(--color-document-foreground);white-space:pre-line;overflow-wrap:anywhere}
.literature-abstract{max-width:840px;margin-top:1.25em}
.literature-abstract h2{margin:0;color:var(--color-document-muted);font:500 9px/18px var(--font-sans);letter-spacing:1px;text-transform:uppercase}
@media(max-width:480px){.literature-fields th{width:100px}.literature-fields td{padding-right:0}}

a{color:var(--color-document-link);text-decoration:none}pre,code{font-family:"JetBrains Mono",ui-monospace,monospace;text-wrap-style:auto}pre{overflow:auto}
svg,img{max-width:100%;height:auto}blockquote{border-left:2px solid var(--color-document-border-strong);padding-left:12px;margin-left:0}
/* Adapt Typst's default math foreground for paper; retain other SVG colors. */
svg [fill="#cdd6f4"]{fill:var(--color-document-foreground)}
svg [stroke="#cdd6f4"]{stroke:var(--color-document-foreground)}
.dox-display-math{display:flex;justify-content:center;margin:1em 0}
::selection{background:var(--color-document-selection);color:var(--color-document-foreground)}
`;
// Keep the compiler's MathML/layout CSS within the shadow tree. No stylesheet
// imports, executable URLs, or rules targeting the application host are accepted.
function scopedStyles(document: Document): string {
    const styles: string[] = [];
    for (const element of document.querySelectorAll("style")) {
        try {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(element.textContent ?? "");
            for (const rule of sheet.cssRules) {
                if (
                    !(rule instanceof CSSStyleRule) ||
                    /:host|::slotted|::part/i.test(rule.selectorText)
                )
                    continue;
                const declarations = Array.from(rule.style).flatMap(
                    (property) => {
                        const value = rule.style.getPropertyValue(property);
                        if (
                            /url\s*\(|image-set\s*\(|expression\s*\(/i.test(
                                value,
                            )
                        )
                            return [];
                        return [
                            `${property}:${value}${rule.style.getPropertyPriority(property) ? " !important" : ""}`,
                        ];
                    },
                );
                styles.push(`${rule.selectorText}{${declarations.join(";")}}`);
            }
        } catch {
            /* An unsupported style does not prevent reading the note. */
        }
    }
    return styles.join("\n");
}
/** The compiler's output is untrusted, even when it originates in local files. */
function prepareNoteHtml(html: string) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    // The column header displays the document title. Hide its body copy only;
    // later headings remain part of the note's content.
    const title = parsed.querySelector("h1") ?? parsed.querySelector("h2");
    title?.remove();
    // Literature titles are also present as a bibliographic field.
    for (const row of parsed.querySelectorAll(".literature-fields tr")) {
        if (
            row.querySelector('th[scope="row"]')?.textContent?.trim() ===
            "Title"
        )
            row.remove();
    }
    const fragment = DOMPurify.sanitize(parsed.body.innerHTML, {
        USE_PROFILES: { html: true, mathMl: true, svg: true, svgFilters: true },
        // Typst SVG text uses local glyph references through <use>.
        ADD_TAGS: ["use"],
        FORBID_TAGS: [
            "script",
            "style",
            "link",
            "meta",
            "base",
            "iframe",
            "object",
            "embed",
            "form",
            "input",
            "textarea",
            "select",
            "button",
            "video",
            "audio",
        ],
        FORBID_ATTR: ["autofocus", "contenteditable", "name"],
        // Extend DOMPurify's default URL policy with dox:. This expression also
        // validates non-URL attributes: restricting it to URLs strips SVG paths,
        // transforms, dimensions, and other ordinary attribute values.
        ALLOWED_URI_REGEXP:
            /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix|dox):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        RETURN_DOM_FRAGMENT: true,
    });
    for (const use of fragment.querySelectorAll("use")) {
        const reference =
            use.getAttribute("href") ?? use.getAttribute("xlink:href") ?? "";
        if (!/^#[A-Za-z0-9_.:-]+$/.test(reference)) use.remove();
    }
    for (const link of fragment.querySelectorAll('a[href^="dox:"]'))
        link.removeAttribute("title");
    return { fragment, styles: scopedStyles(parsed) };
}

export type NoteViewProps = {
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
            if (/^dox:[0-9A-Z]{5}$/.test(href)) props.onNavigate(href.slice(4));
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
                /^dox:[0-9A-Z]{5}$/.test(link.getAttribute("href") ?? "")
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
    });
    createEffect(() => {
        const article = content();
        const html = props.html;
        if (!article) return;
        const { fragment, styles } = prepareNoteHtml(html);
        compiledStyles.textContent = styles;
        setHoveredLink(undefined);
        setFocusedLink(undefined);
        article.replaceChildren(fragment);
        host.scrollTop = 0;
    });
    return (
        <>
            <div
                ref={host}
                class="h-full w-full bg-document-background text-document-foreground [color-scheme:light]"
                role="region"
                aria-label="Rendered note"
                tabIndex={0}
            />
            <Tooltip anchor={tooltipAnchor()} text={tooltipText()} />
        </>
    );
}
