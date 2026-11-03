import DOMPurify from "dompurify";
import { createMemo } from "solid-js";
import type { Entry } from "./types";

export default function RichTitle(props: { note: Pick<Entry, 'title' | 'title_html'> }) {
  const html = createMemo(() => {
    const parsed = new DOMParser().parseFromString(props.note.title_html ?? '', 'text/html');
    if (!props.note.title_html) parsed.body.textContent = props.note.title;
    for (const svg of parsed.querySelectorAll('svg')) {
      for (const dimension of ['width', 'height'] as const) {
        if (/^(?:\d+(?:\.\d+)?|\.\d+)em$/.test(svg.style[dimension])) svg.setAttribute(dimension, svg.style[dimension]);
      }
    }
    const fragment = DOMPurify.sanitize(parsed.body.innerHTML, {
      USE_PROFILES: { html: true, mathMl: true, svg: true }, ADD_TAGS: ['use'],
      FORBID_TAGS: ['style', 'a', 'img', 'form', 'input', 'button', 'textarea', 'select', 'video', 'audio', 'foreignObject'],
      FORBID_ATTR: ['style', 'tabindex', 'autofocus', 'contenteditable', 'name'], RETURN_DOM_FRAGMENT: true,
    });
    for (const use of fragment.querySelectorAll('use')) {
      if (!/^#[A-Za-z0-9_.:-]+$/.test(use.getAttribute('href') ?? use.getAttribute('xlink:href') ?? '')) use.remove();
    }
    for (const element of fragment.querySelectorAll('svg [fill], svg [stroke]')) {
      for (const attribute of ['fill', 'stroke']) {
        if (element.getAttribute(attribute) === '#cdd6f4') element.setAttribute(attribute, 'currentColor');
      }
    }
    const template = document.createElement('template');
    template.content.append(fragment);
    return template.innerHTML;
  });
  return <span class="rich-title" innerHTML={html()} />;
}
