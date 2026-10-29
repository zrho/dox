import DOMPurify from "dompurify";
import { createMemo } from "solid-js";

export type TitledNote = {
  title: string;
  title_text?: string;
  title_html?: string | null;
};
export function titleText(note: TitledNote) {
  return note.title_text || note.title;
}

function titleHtml(note: TitledNote, positions?: number[]) {
  const template = document.createElement("template");
  if (note.title_html != null) {
    // Work in an inert template, then sanitize before displaying anything.
    // Typst supplies font-relative SVG sizes as CSS; retain only these numeric
    // dimensions as SVG attributes while discarding all title styles below.
    template.innerHTML = note.title_html;
    for (const svg of template.content.querySelectorAll("svg")) {
      for (const dimension of ["width", "height"] as const) {
        const size = svg.style[dimension];
        if (/^(?:\d+(?:\.\d+)?|\.\d+)em$/.test(size))
          svg.setAttribute(dimension, size);
      }
    }
    template.innerHTML = DOMPurify.sanitize(template.innerHTML, {
      USE_PROFILES: { html: true, mathMl: true, svg: true },
      ADD_TAGS: ["use"],
      FORBID_TAGS: [
        "style",
        "a",
        "form",
        "input",
        "button",
        "textarea",
        "select",
        "img",
        "video",
        "audio",
        "foreignObject",
      ],
      FORBID_ATTR: [
        "style",
        "tabindex",
        "autofocus",
        "contenteditable",
        "name",
      ],
    });
  } else {
    template.content.append(document.createTextNode(titleText(note)));
  }
  for (const use of template.content.querySelectorAll("use")) {
    const reference =
      use.getAttribute("href") ?? use.getAttribute("xlink:href") ?? "";
    if (!/^#[A-Za-z0-9_.:-]+$/.test(reference)) use.remove();
  }
  // Typst's default SVG math colour should follow the surrounding title text,
  // including selection and match highlighting. Keep explicit colours intact.
  for (const element of template.content.querySelectorAll("svg [fill], svg [stroke]")) {
    for (const attribute of ["fill", "stroke"]) {
      if (element.getAttribute(attribute) === "#cdd6f4")
        element.setAttribute(attribute, "currentColor");
    }
  }
  const matches = new Set(positions ?? []);
  if (matches.size) {
    // Highlight text while preserving compiled SVG and other title markup.
    const walker = document.createTreeWalker(
      template.content,
      NodeFilter.SHOW_TEXT,
    );
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      nodes.push(node as Text);
    let offset = 0;
    for (const node of nodes) {
      const text = node.data;
      const start = offset;
      offset += text.length;
      const math = node.parentElement?.closest("math");
      if (math) {
        if ([...matches].some((index) => index >= start && index < offset))
          math.classList.add("text-link", "font-semibold");
        continue;
      }
      const fragment = document.createDocumentFragment();
      let index = 0;
      while (index < text.length) {
        const matched = matches.has(start + index);
        let end = index + 1;
        while (end < text.length && matches.has(start + end) === matched) end++;
        if (matched) {
          const span = document.createElement("span");
          span.className = "text-link font-semibold";
          span.textContent = text.slice(index, end);
          fragment.append(span);
        } else fragment.append(document.createTextNode(text.slice(index, end)));
        index = end;
      }
      node.replaceWith(fragment);
    }
  }
  return template.innerHTML;
}

/** Compiled title markup never gets the desktop app's scripting privileges. */
export default function NoteTitle(props: {
  note: TitledNote;
  positions?: number[];
}) {
  const html = createMemo(() => titleHtml(props.note, props.positions));
  return (
    <span
      class="leading-[inherit] [&_math]:text-[1em] [&_math]:[math-style:compact] [&_math[display=block]]:[display:inline_math] [&_p]:m-0 [&_p]:inline [&_svg]:inline-block [&_svg]:max-h-[1.4em] [&_svg]:max-w-full [&_svg]:align-baseline"
      innerHTML={html()}
    />
  );
}
