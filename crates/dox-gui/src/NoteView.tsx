import Tooltip from './ui/components/Tooltip';
import DOMPurify from 'dompurify';
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

const baseStyles = `
:host{display:block;height:100%;min-height:0;overflow:auto;background:#1c1e22;color:#d9dce3;color-scheme:dark;contain:layout paint style;outline:none}
.note-content{box-sizing:border-box;margin:0;padding:10px 12px;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;overflow-wrap:break-word}
h1,h2,h3{line-height:1.25;color:#f0f1f4;margin:.65em 0 .35em}
h1{font-size:22px;letter-spacing:-.3px}h2{font-size:18px}h3{font-size:15px}
p{margin:.5em 0}.note-content>:first-child{margin-top:0}
/* Typst emits h1 for #title and h2 for a level-one heading. */
.note-content [data-dox-document-title]{font-size:22px!important;line-height:1.25!important;font-weight:600;letter-spacing:-.3px;margin-top:0}
.literature-fields{width:100%;max-width:840px;border-collapse:collapse;font-size:12px;line-height:1.45;text-align:left;margin-top:12px}
.literature-fields th,.literature-fields td{padding:4px 10px;border-bottom:1px solid #30353e;vertical-align:top}
.literature-fields tr:first-child>*{border-top:1px solid #30353e}
.literature-fields th{width:140px;padding-left:0;color:#8e9bad;font-size:11px;font-weight:500;text-align:right}
.literature-fields td{color:#d5dce7;white-space:pre-line;overflow-wrap:anywhere}
@media(max-width:480px){.literature-fields th{width:100px}.literature-fields td{padding-right:0}}

a{color:#a4c6ef}pre,code{font-family:ui-monospace,monospace}pre{overflow:auto}
svg,img{max-width:100%;height:auto}blockquote{border-left:2px solid #5c6575;padding-left:12px;margin-left:0}
::selection{background:#3a526f;color:#edf3fb}
`;

// Keep the compiler's MathML/layout CSS within the shadow tree. No stylesheet
// imports, executable URLs, or rules targeting the application host are accepted.
function scopedStyles(document: Document): string {
  const styles: string[] = [];
  for (const element of document.querySelectorAll('style')) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(element.textContent ?? '');
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSStyleRule) || /:host|::slotted|::part/i.test(rule.selectorText)) continue;
        const declarations = Array.from(rule.style).flatMap(property => {
          const value = rule.style.getPropertyValue(property);
          if (/url\s*\(|image-set\s*\(|expression\s*\(/i.test(value)) return [];
          return [`${property}:${value}${rule.style.getPropertyPriority(property) ? ' !important' : ''}`];
        });
        styles.push(`${rule.selectorText}{${declarations.join(';')}}`);
      }
    } catch { /* An unsupported style does not prevent reading the note. */ }
  }
  return styles.join('\n');
}

export default function NoteView(props: { html: string; onNavigate: (id: string) => void; getNoteTitle: (id: string) => string | undefined; active?: boolean }) {
  let host!: HTMLDivElement;
  let compiledStyles: HTMLStyleElement;
  const [hoveredLink, setHoveredLink] = createSignal<HTMLAnchorElement>();
  const [focusedLink, setFocusedLink] = createSignal<HTMLAnchorElement>();
  const tooltipAnchor = () => props.active === false ? undefined : hoveredLink() ?? focusedLink();
  const tooltipText = () => {
    const href = tooltipAnchor()?.getAttribute('href') ?? '';
    return props.getNoteTitle(href.slice(4));
  };
  const [content, setContent] = createSignal<HTMLElement>();
  onMount(() => {
    const root = host.attachShadow({ mode: 'open' });
    compiledStyles = document.createElement('style');
    const defaults = document.createElement('style');
    defaults.textContent = baseStyles;
    const article = document.createElement('article');
    article.className = 'note-content';
    root.append(compiledStyles, defaults, article);
    setContent(article);
    const navigate = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest('a') : null;
      if (!target) return;
      const href = target.getAttribute('href') ?? target.getAttribute('xlink:href') ?? '';
      event.preventDefault();
      if (/^dox:[0-9A-Z]{5}$/.test(href)) props.onNavigate(href.slice(4));
      else if (href.startsWith('#')) {
        try { root.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' }); }
        catch { /* Ignore invalid fragment encoding. */ }
      }
    };
    const internalLink = (target: EventTarget | null) => {
      const link = target instanceof Element ? target.closest('a') : null;
      return link instanceof HTMLAnchorElement && /^dox:[0-9A-Z]{5}$/.test(link.getAttribute('href') ?? '') ? link : undefined;
    };
    const hover = (event: MouseEvent) => setHoveredLink(internalLink(event.target));
    const leave = (event: MouseEvent) => setHoveredLink(internalLink(event.relatedTarget));
    const focus = (event: FocusEvent) => setFocusedLink(internalLink(event.target));
    const blur = (event: FocusEvent) => setFocusedLink(internalLink(event.relatedTarget));
    root.addEventListener('click', navigate);
    root.addEventListener('mouseover', hover);
    root.addEventListener('mouseout', leave);
    root.addEventListener('focusin', focus);
    root.addEventListener('focusout', blur);
    onCleanup(() => {
      root.removeEventListener('click', navigate);
      root.removeEventListener('mouseover', hover);
      root.removeEventListener('mouseout', leave);
      root.removeEventListener('focusin', focus);
      root.removeEventListener('focusout', blur);
    });
  });
  createEffect(() => {
    const article = content();
    const html = props.html;
    if (!article) return;
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    // Give both document formats one title scale, leaving subsections unchanged.
    const title = parsed.querySelector('h1') ?? parsed.querySelector('h2');
    title?.setAttribute('data-dox-document-title', '');
    const fragment = DOMPurify.sanitize(parsed.body.innerHTML, {
      USE_PROFILES: { html: true, mathMl: true, svg: true, svgFilters: true },
      // Typst SVG text uses local glyph references through <use>.
      ADD_TAGS: ['use'],
      FORBID_TAGS: ['script', 'style', 'link', 'meta', 'base', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button', 'video', 'audio'],
      FORBID_ATTR: ['autofocus', 'contenteditable', 'name'],
      ALLOWED_URI_REGEXP: /^(?:dox:|#|data:image\/(?:png|jpeg|gif|webp|svg\+xml);)/i,
      RETURN_DOM_FRAGMENT: true,
    });
    for (const use of fragment.querySelectorAll('use')) {
      const reference = use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '';
      if (!/^#[A-Za-z0-9_.:-]+$/.test(reference)) use.remove();
    }
    // Prepare off-DOM, then replace the contents within the same persistent view.
    compiledStyles.textContent = scopedStyles(parsed);
    for (const link of fragment.querySelectorAll('a[href^="dox:"]')) link.removeAttribute('title');
    setHoveredLink(undefined); setFocusedLink(undefined);
    article.replaceChildren(fragment);
    host.scrollTop = 0;
  });
  return <>
    <div ref={host} class="note-view" role="region" aria-label="Rendered note" tabIndex={0}/>
    <Tooltip anchor={tooltipAnchor()} text={tooltipText()}/>
  </>;
}
