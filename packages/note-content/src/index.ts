/** Content rendering shared by the independent desktop and web applications. */
export const noteSanitizeOptions = {
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
};

export const baseStyles = `
:host{display:block;height:100%;min-height:0;overflow:auto;overscroll-behavior-y:none;background:var(--color-document-background);color:var(--color-document-foreground);color-scheme:light;contain:layout paint style;outline:none;scrollbar-width:none}
:host::-webkit-scrollbar{display:none}
*{overscroll-behavior-y:none}
.note-content{box-sizing:border-box;margin:0;padding:10px 12px;font:16px/1.5 var(--font-sans);overflow-wrap:break-word;text-wrap:balance}
.note-content :where(:not(math,math *,svg,svg *)){font-family:var(--font-sans)!important}
h1,h2,h3{line-height:1.25;color:var(--color-document-foreground);margin:.65em 0 .35em}
h1{font-size:24px;letter-spacing:-.3px}h2{font-size:20px}h3{font-size:17px}
.note-content .note-title{font-size:16px;font-weight:600;line-height:1.3;letter-spacing:normal;margin:0 0 .55em}
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

.note-content a[href]{color:var(--color-document-link);text-decoration:none}pre,code{text-wrap-style:auto}pre{overflow:auto}
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
export function prepareNoteHtml(html: string, titleText: string, sanitize: (html: string) => DocumentFragment) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    // Keep the compiler's rich title and anchor in the scrolling body.
    const title = parsed.querySelector("h1") ?? parsed.querySelector("h2");
    if (title) title.classList.add("note-title");
    else {
        const fallback = parsed.createElement("h1");
        fallback.className = "note-title";
        fallback.textContent = titleText;
        parsed.body.prepend(fallback);
    }
    // Literature titles are also present as a bibliographic field.
    for (const row of parsed.querySelectorAll(".literature-fields tr")) {
        if (
            row.querySelector('th[scope="row"]')?.textContent?.trim() ===
            "Title"
        )
            row.remove();
    }
    const fragment = sanitize(parsed.body.innerHTML);
    for (const use of fragment.querySelectorAll("use")) {
        const reference =
            use.getAttribute("href") ?? use.getAttribute("xlink:href") ?? "";
        if (!/^#[A-Za-z0-9_.:-]+$/.test(reference)) use.remove();
    }
    for (const link of fragment.querySelectorAll('a[href^="dox:"]'))
        link.removeAttribute("title");
    return { fragment, styles: scopedStyles(parsed) };
}

