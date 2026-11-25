//! The fixed, isolated WebView shell. Note HTML arrives as data, never as a navigation.

const START: &str = r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-Zahb3ZkU7m6WJbtu36j5n3NbGIuF44bWu4wh6dF3YmI='; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>Note preview</title>
</head><body style="margin:0"><main id="preview"></main><template id="preview-style"><style>"#;

const STYLES: &str = include_str!("preview.css");

// The CSP hash covers BOOTSTRAP verbatim (from the opening '(' through '();').
// Keep this script static. The message listener treats note bytes as untrusted data.
const BOOTSTRAP: &str = r###"(() => {
    'use strict';
    const html = 'http://www.w3.org/1999/xhtml';
    const svg = 'http://www.w3.org/2000/svg';
    const math = 'http://www.w3.org/1998/Math/MathML';
    const xlink = 'http://www.w3.org/1999/xlink';
    const words = text => new Set(text.split(/\s+/).filter(Boolean));
    const tags = new Map([
        [html, words(`a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup
            dd del dfn details div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img
            kbd li main mark nav ol p pre q rp rt ruby s samp section small span strong sub summary sup
            table tbody td tfoot th thead time tr u ul var wbr`)],
        [svg, words(`a svg g defs symbol use path rect circle ellipse line polyline polygon text tspan
            textPath title desc clipPath mask marker pattern linearGradient radialGradient stop image`)],
        [math, words(`math mrow mi mn mo mtext ms mspace mfrac msqrt mroot mstyle merror mpadded
            mphantom mfenced menclose msub msup msubsup munder mover munderover mmultiscripts
            mprescripts none mtable mtr mtd semantics`)],
    ]);
    const common = words('id class lang dir title role aria-label aria-labelledby aria-describedby aria-hidden');
    const attrs = new Map([
        [html, words('alt width height colspan rowspan scope start reversed value open datetime')],
        [svg, words(`viewBox preserveAspectRatio x y x1 x2 y1 y2 cx cy r rx ry fx fy fr width height
            d points transform overflow opacity fill-opacity fill-rule stroke-opacity stroke-width
            stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset clip-rule
            clipPathUnits maskUnits maskContentUnits gradientUnits gradientTransform spreadMethod
            patternUnits patternContentUnits patternTransform offset stop-color stop-opacity
            markerUnits markerWidth markerHeight refX refY orient text-anchor dominant-baseline
            alignment-baseline font-family font-size font-weight font-style dx dy rotate textLength
            lengthAdjust startOffset vector-effect`)],
        [math, words(`display mathvariant mathsize mathcolor mathbackground displaystyle scriptlevel
            stretchy fence separator symmetric largeop movablelimits accent accentunder lspace rspace
            minsize maxsize linethickness columnalign rowalign columnspacing rowspacing columnspan
            rowspan width height depth notation`)],
    ]);
    const paint = words('fill stroke clip-path mask marker-start marker-mid marker-end');
    const inline = words(`color background-color display visibility opacity width height min-width min-height
        max-width max-height vertical-align text-align text-indent text-decoration-line text-decoration-style
        text-decoration-color white-space overflow-wrap font-family font-size font-weight font-style
        line-height letter-spacing word-spacing margin margin-block margin-inline margin-top margin-right
        margin-bottom margin-left padding padding-block padding-inline padding-top padding-right
        padding-bottom padding-left border border-width border-style border-color border-collapse
        border-spacing box-sizing list-style-type image-rendering`);
    const localRef = /^#[A-Za-z0-9_.:-]+$/;
    const localPaint = /^url\(#[A-Za-z0-9_.:-]+\)$/;
    const plainPaint = /^(?:[A-Za-z]+|#[0-9a-f]{3,8}|(?:rgba?|hsla?)\([0-9.,%+ /-]+\))$/i;
    // These sources are used only in image elements, never as documents or links.
    const imageData = /^data:image\/(?:png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/i;
    const targets = new WeakMap();
    const root = document.getElementById('preview').attachShadow({ mode: 'closed' });
    const article = document.createElement('article');
    const stylesheet = document.getElementById('preview-style');
    root.append(stylesheet.content, article);
    stylesheet.remove();
    const svgRefs = words('use textPath linearGradient radialGradient pattern');
    function copy(node, parent) {
        if (node.nodeType === 3) {
            parent.append(document.createTextNode(node.data));
            return;
        }
        if (node.nodeType !== 1) return;
        const ns = node.namespaceURI;
        const tag = node.localName;
        if (!tags.get(ns)?.has(tag)) return;
        const out = document.createElementNS(ns, tag);
        for (const attr of node.attributes) {
            if (attr.namespaceURI !== null) continue;
            const key = attr.localName;
            const value = attr.value;
            if (common.has(key) || attrs.get(ns).has(key) ||
                (ns === svg && paint.has(key) && (localPaint.test(value) || plainPaint.test(value)))) {
                out.setAttribute(key, value);
            }
        }
        if (node.style && out.style) {
            for (const property of Array.from(node.style)) {
                if (!inline.has(property)) continue;
                const value = node.style.getPropertyValue(property);
                // Keep values with resource functions and CSS escapes out of the live tree.
                if (!/\\|url\s*\(|image-set\s*\(|attr\s*\(|var\s*\(/i.test(value)) {
                    out.style.setProperty(property, value);
                }
            }
        }

        const reference = node.getAttribute('href') ?? node.getAttributeNS(xlink, 'href') ?? '';
        if (ns === svg && svgRefs.has(tag) && localRef.test(reference)) {
            out.setAttributeNS(xlink, 'xlink:href', reference);
        } else if (ns === svg && tag === 'image' && imageData.test(reference)) {
            out.setAttributeNS(xlink, 'xlink:href', reference);
        } else if (ns === html && tag === 'img') {
            const src = node.getAttribute('src') ?? '';
            if (imageData.test(src)) out.setAttribute('src', src);
        } else if (tag === 'a') {
            // No live href: links cannot navigate, download, or open a WebView popup.
            if (/^(?:#|dox:|https?:\/\/)/i.test(reference)) {
                targets.set(out, reference);
                out.setAttribute('role', 'link');
                out.setAttribute('tabindex', '0');
            }
        }
        for (const child of node.childNodes) copy(child, out);
        parent.append(out);
    }
    function render({ html: markup, title }) {
        // Read the inert tree, but never adopt or reparse any of its nodes.
        const parsed = document.createElement('template');
        parsed.innerHTML = markup;
        const content = document.createDocumentFragment();
        for (const node of parsed.content.childNodes) copy(node, content);
        let heading = content.querySelector('h1') ?? content.querySelector('h2');
        if (!heading) {
            heading = document.createElement('h1');
            heading.textContent = title;
            content.prepend(heading);
        }
        heading.classList.add('note-title');
        for (const row of content.querySelectorAll('.literature-fields tr')) {
            if (row.querySelector('th[scope="row"]')?.textContent.trim() === 'Title') row.remove();
        }
        article.replaceChildren(content);
        window.scrollTo(0, 0);
    }

    function activate(event) {
        if (!event.isTrusted) return;
        if (event.type === 'keydown' && (event.key !== 'Enter' || event.repeat)) return;
        const link = event.composedPath().find(node => targets.has(node));
        if (!link) return;
        const target = targets.get(link);
        event.preventDefault();
        if (target.startsWith('#')) {
            try {
                const id = decodeURIComponent(target.slice(1));
                (id ? root.getElementById(id) : article)?.scrollIntoView({ block: 'start' });
            } catch { /* Ignore a malformed fragment. */ }
        } else if (/^dox:(?:[0-9A-Z]{5}|[0-9]{4}-[0-9]{2}-[0-9]{2})$/.test(target)) {
            window.nsh?.postMessage('note:' + target.slice(4));
        } else if (/^https?:\/\//i.test(target) && target.length <= 16384) {
            window.nsh?.postMessage('external:' + target);
        }
    }
    document.addEventListener('pointerdown', event => {
        if (event.isTrusted) window.nsh?.postMessage('activate');
    }, true);
    // Hand horizontal trackpad gestures to the native pane strip. Leave vertical
    // gestures, including vertical momentum, in this document.
    let pendingX = 0;
    let wheelFrame = 0;
    document.addEventListener('wheel', event => {
        if (!event.isTrusted || event.ctrlKey || event.metaKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
        event.preventDefault();
        const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerWidth : 1;
        pendingX += event.deltaX * scale;
        if (!wheelFrame) wheelFrame = requestAnimationFrame(() => {
            wheelFrame = 0;
            const delta = pendingX;
            pendingX = 0;
            if (delta) window.nsh?.postMessage('wheel-x:' + delta);
        });
    }, { capture: true, passive: false });
    root.addEventListener('click', activate);
    root.addEventListener('keydown', activate);
    window.addEventListener('message', event => {
        if (typeof event.data !== 'string') return;
        try {
            const data = JSON.parse(event.data);
            if (data?.type !== 'render-note' || typeof data.html !== 'string' || typeof data.title !== 'string') return;
            render(data);
        } catch {
            window.nsh?.postMessage('render-error');
        }
    });
    window.nsh?.postMessage('preview-ready');
})();"###;

pub fn shell() -> String {
    [
        START,
        STYLES,
        "</style></template><script>",
        BOOTSTRAP,
        "</script></body></html>",
    ]
    .concat()
}
