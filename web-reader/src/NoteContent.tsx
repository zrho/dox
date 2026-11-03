import DOMPurify from "dompurify";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { baseStyles, noteSanitizeOptions, prepareNoteHtml } from "../../packages/note-content/src";
import type { Note } from "./types";

/** The reading surface uses normal document scrolling, independent of desktop panes. */
export default function NoteContent(props: { note: Note }) {
  let host!: HTMLDivElement;
  const [article, setArticle] = createSignal<HTMLElement>();
  let compiledStyles: HTMLStyleElement;
  onMount(() => {
    const root = host.attachShadow({ mode: "open" });
    const defaults = document.createElement('style');
    defaults.textContent = `${baseStyles}\n:host{height:auto;overflow:visible;contain:none;overscroll-behavior:auto}\n.note-content{padding:0;font-size:17px;line-height:1.65;text-wrap:pretty}\n.note-content .note-title{font-size:26px;line-height:1.25;margin-bottom:1em}*{overscroll-behavior:auto}pre{max-width:100%;overflow-x:auto}`;
    compiledStyles = document.createElement('style');
    const content = document.createElement('article');
    content.className = 'note-content';
    root.append(compiledStyles, defaults, content);
    const navigate = (event: Event) => {
      if (!(event instanceof MouseEvent)) return;
      const target = event.target instanceof Element ? event.target.closest('a') : null;
      const href = target?.getAttribute('href') ?? '';
      if (href.startsWith('#') && !href.startsWith('#/') && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        try { root.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' }); } catch { /* Malformed fragment. */ }
      }
    };
    root.addEventListener('click', navigate);
    onCleanup(() => root.removeEventListener('click', navigate));
    setArticle(content);
  });
  createEffect(() => {
    const content = article();
    if (!content) return;
    const { fragment, styles } = prepareNoteHtml(props.note.html, props.note.title, input => DOMPurify.sanitize(input, { ...noteSanitizeOptions, RETURN_DOM_FRAGMENT: true }));
    if (props.note.kind === 'literature') {
      // The shared fallback is plain text; retain the compiled publication title.
      const title = fragment.querySelector('h1.note-title');
      if (title && props.note.title_html) {
        title.replaceChildren(DOMPurify.sanitize(new DOMParser().parseFromString(props.note.title_html, 'text/html').body.innerHTML, { ...noteSanitizeOptions, RETURN_DOM_FRAGMENT: true }));
      }
    }
    for (const link of fragment.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const href = link.getAttribute('href') ?? '';
      if (/^dox:(?:[0-9A-Z]{5}|\d{4}-\d{2}-\d{2})$/.test(href)) {
        link.href = `#/note/${encodeURIComponent(href.slice(4))}`;
      } else if (/^https?:\/\//i.test(href)) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } else if (!href.startsWith('#') && !/^mailto:|^tel:/i.test(href)) {
        link.removeAttribute('href');
      }
    }
    compiledStyles.textContent = styles;
    content.replaceChildren(fragment);
  });
  return <div ref={host} class="note-content-host" />;
}
