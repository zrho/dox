use std::{
    ops::Range,
    time::{Duration, Instant},
};

use nsh_base::editor::{
    EditorHighlighter, EditorLanguage, EditorText, EditorTextEdit, EditorToken, EditorTokens,
    register_highlighter, register_language,
};
use typst_syntax::{LinkedNode, Tag, highlight, parse};

static TYPST: EditorLanguage = EditorLanguage::new("Typst")
    .extensions(&["typ"])
    .line_comment("//")
    .block_comment("/*", "*/")
    .auto_close(&[('(', ')'), ('[', ']'), ('{', '}'), ('"', '"')])
    .word_chars("-")
    .string_quotes("\"");

pub(crate) fn register() {
    register_language(&TYPST);
    register_highlighter(TYPST.name(), || Box::new(TypstHighlighter::default()));
}

type TokenSpan = (Range<usize>, EditorToken);

#[derive(Default)]
struct TypstHighlighter {
    spans: Option<Vec<TokenSpan>>,
    first_span: usize,
    next_line: usize,
    offset: usize,
    finished: bool,
    line: String,
}

impl EditorHighlighter for TypstHighlighter {
    fn edited(&mut self, _: &EditorTextEdit) {
        // An edit can change the syntax before it, for example when it closes a raw block.
        *self = Self::default();
    }

    fn highlight(
        &mut self,
        text: &EditorText,
        last_line: usize,
        budget: Duration,
        tokens: &mut EditorTokens,
    ) -> bool {
        if self.finished || self.next_line > last_line {
            return true;
        }
        let start = Instant::now();
        // Parse once for this snapshot, then send lines within the editor's time budget.
        let spans = self.spans.get_or_insert_with(|| {
            let root = parse(&text.rope().to_string());
            let mut spans = Vec::new();
            collect(&LinkedNode::new(&root), None, &mut spans);
            spans
        });

        loop {
            let has_break = text.read_line(self.offset, &mut self.line);
            let line_end = self.offset + self.line.len() - usize::from(has_break);
            let offset = self.offset;
            tokens.line(
                self.next_line,
                spans[self.first_span..]
                    .iter()
                    .take_while(|(range, _)| range.start < line_end)
                    .filter_map(|(range, token)| {
                        let start = range.start.max(offset);
                        let end = range.end.min(line_end);
                        (start < end).then(|| (start - offset..end - offset, *token))
                    }),
            );
            self.offset += self.line.len();
            self.first_span +=
                spans[self.first_span..].partition_point(|(range, _)| range.end <= self.offset);
            self.next_line += 1;
            if !has_break {
                self.finished = true;
                return true;
            }
            if self.next_line > last_line {
                return true;
            }
            if start.elapsed() >= budget {
                return false;
            }
        }
    }

    fn frontier(&self) -> usize {
        self.next_line
    }
}

fn collect(node: &LinkedNode<'_>, parent: Option<EditorToken>, spans: &mut Vec<TokenSpan>) {
    let token = highlight(node).and_then(editor_token).or(parent);
    if node.get().children().len() != 0 {
        for child in node.children() {
            collect(&child, token, spans);
        }
    } else if let Some(token) = token {
        let range = node.range();
        if range.is_empty() {
            return;
        }
        match spans.last_mut() {
            Some((last, kind)) if last.end == range.start && *kind == token => {
                last.end = range.end;
            }
            _ => spans.push((range, token)),
        }
    }
}

fn editor_token(tag: Tag) -> Option<EditorToken> {
    Some(match tag {
        Tag::Comment => EditorToken::Comment,
        Tag::Heading | Tag::Keyword | Tag::ListMarker => EditorToken::Keyword,
        Tag::Escape | Tag::Raw | Tag::String => EditorToken::String,
        Tag::Number => EditorToken::Number,
        Tag::Function | Tag::Strong | Tag::Emph | Tag::ListTerm => EditorToken::Title,
        Tag::Label | Tag::Ref | Tag::Link | Tag::Interpolated => EditorToken::Attr,
        Tag::MathDelimiter | Tag::MathOperator | Tag::MathGroupingParens => EditorToken::Built,
        Tag::Punctuation | Tag::Operator | Tag::Error => return None,
    })
}
