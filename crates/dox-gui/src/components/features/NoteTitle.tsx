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
    template.innerHTML = DOMPurify.sanitize(note.title_html, {
      USE_PROFILES: { html: true, mathMl: true, svg: true },
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
  const matches = new Set(positions ?? []);
  if (matches.size) {
    // Highlight text without replacing the compiled MathML with plain text.
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
          math.classList.add("text-[#a9ceff]", "font-semibold");
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
          span.className = "text-[#a9ceff] font-semibold";
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
      class="leading-[inherit] [&_math]:text-[1em] [&_math]:[math-style:compact] [&_math[display=block]]:[display:inline_math] [&_p]:m-0 [&_p]:inline [&_svg]:max-h-[1.4em] [&_svg]:max-w-full [&_svg]:align-middle"
      innerHTML={html()}
    />
  );
}
