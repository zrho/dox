//! Convert compiled title HTML into a bounded set of native text runs.

use dom_query::{Document, NodeData, NodeRef};
use serde::Serialize;

const MAX_HTML_BYTES: usize = 16 * 1024;
const MAX_DEPTH: usize = 32;
const MAX_SPANS: usize = 128;

#[derive(Clone, Copy, Default, PartialEq, Eq, Serialize)]
struct Marks {
    #[serde(skip_serializing_if = "is_false")]
    bold: bool,
    #[serde(skip_serializing_if = "is_false")]
    italic: bool,
    #[serde(skip_serializing_if = "is_false")]
    mono: bool,
    #[serde(skip_serializing_if = "is_false")]
    underline: bool,
    #[serde(skip_serializing_if = "is_false")]
    strike: bool,
    #[serde(skip_serializing_if = "is_false")]
    small_caps: bool,
}

fn is_false(value: &bool) -> bool {
    !value
}

#[derive(Serialize)]
pub(super) struct TitleSpan {
    text: String,
    #[serde(flatten)]
    marks: Marks,
}

pub(super) fn spans(html: &str, plain: &str) -> Option<Vec<TitleSpan>> {
    if html.len() > MAX_HTML_BYTES {
        return None;
    }
    let document = Document::fragment(html);
    // SVG math can contain glyphs that have no text nodes. Do not show an
    // incomplete title or pass foreign markup to a renderer.
    if document.select_single("svg, math").exists() {
        return None;
    }
    let mut title = Title::default();
    title.visit(document.root(), Marks::default(), 0)?;
    match title.spans.as_slice() {
        [] => None,
        [span] if span.marks == Marks::default() && span.text == plain => None,
        _ => Some(title.spans),
    }
}

#[derive(Default)]
struct Title {
    spans: Vec<TitleSpan>,
    space_pending: bool,
}

impl Title {
    fn visit(&mut self, node: NodeRef<'_>, mut marks: Marks, depth: usize) -> Option<()> {
        if depth > MAX_DEPTH {
            return None;
        }
        let (visit_children, block) = node.query(|node| match &node.data {
            NodeData::Text { contents } => {
                self.push(contents, marks)?;
                Some((false, false))
            }
            NodeData::Document | NodeData::Fragment => Some((true, false)),
            NodeData::Element(element)
                if element.name.ns.as_ref() == "http://www.w3.org/1999/xhtml" =>
            {
                match element.name.local.as_ref() {
                    "b" | "strong" => marks.bold = true,
                    "i" | "em" => marks.italic = true,
                    "code" | "kbd" | "samp" => marks.mono = true,
                    "u" => marks.underline = true,
                    "s" | "del" | "strike" => marks.strike = true,
                    "span" => {
                        // Recognize specific values emitted by Typst. Never send
                        // source CSS, URLs, class names, or other attributes.
                        if let Some(style) = element.attr("style") {
                            for declaration in style.split(';') {
                                let Some((property, value)) = declaration.split_once(':') else {
                                    continue;
                                };
                                match (property.trim(), value.trim()) {
                                    ("text-decoration", "underline") => marks.underline = true,
                                    ("font-variant-caps", "small-caps") => marks.small_caps = true,
                                    _ => {}
                                }
                            }
                        }
                    }
                    "br" => {
                        self.space_pending = true;
                        return Some((false, false));
                    }
                    "p" | "div" | "pre" => return Some((true, true)),
                    // These wrappers contribute only their text. Links are not interactive.
                    "html" | "body" | "a" | "abbr" | "cite" | "mark" | "q" | "small" | "sub"
                    | "sup" | "var" | "wbr" => {}
                    _ => return Some((false, false)),
                }
                Some((true, false))
            }
            _ => Some((false, false)),
        })??;
        if visit_children {
            self.space_pending |= block;
            for child in node.children_it(false) {
                self.visit(child, marks, depth + 1)?;
            }
            self.space_pending |= block;
        }
        Some(())
    }

    fn push(&mut self, text: &str, marks: Marks) -> Option<()> {
        for c in text.chars() {
            if matches!(
                c,
                ' ' | '\t' | '\r' | '\n' | '\x0c' | '\x0b' | '\u{2028}' | '\u{2029}'
            ) {
                self.space_pending = true;
                continue;
            }
            if std::mem::take(&mut self.space_pending) {
                if let Some(span) = self.spans.last_mut() {
                    span.text.push(' ');
                }
            }
            if let Some(span) = self.spans.last_mut().filter(|span| span.marks == marks) {
                span.text.push(c);
            } else {
                if self.spans.len() >= MAX_SPANS {
                    return None;
                }
                self.spans.push(TitleSpan {
                    text: c.into(),
                    marks,
                });
            }
        }
        Some(())
    }
}
