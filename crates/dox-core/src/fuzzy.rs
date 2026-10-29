//! Shared native ranking for note and command pickers.
use nucleo_matcher::{
    Config, Matcher, Utf32Str,
    pattern::{Atom, AtomKind, CaseMatching, Normalization},
};
use serde::Serialize;
use std::cell::RefCell;
use unicode_segmentation::UnicodeSegmentation;

#[derive(Debug, Serialize)]
pub struct FuzzyMatch {
    pub score: u16,
    /// UTF-16 offsets, including every code unit in a matched grapheme.
    pub positions: Vec<u32>,
}

#[derive(Debug, Serialize)]
pub struct FuzzyResult {
    /// Index into the submitted candidate snapshot; fields keep their input order.
    pub index: usize,
    pub matches: Vec<Option<FuzzyMatch>>,
    pub score: u16,
}

thread_local! {
    // Nucleo's scratch allocation is reused across requests on each worker thread.
    static MATCHER: RefCell<Matcher> = RefCell::new(Matcher::new(Config::DEFAULT));
}

/// Match each candidate's fields independently, ranking by its best field.
/// Query punctuation stays literal; whitespace is ignored as in the original picker.
pub fn fuzzy_find(query: &str, candidates: &[Vec<String>]) -> Vec<FuzzyResult> {
    let needle: String = query.chars().filter(|ch| !ch.is_whitespace()).collect();
    let atom = Atom::new(
        &needle,
        CaseMatching::Ignore,
        Normalization::Smart,
        AtomKind::Fuzzy,
        false,
    );
    MATCHER.with_borrow_mut(|matcher| {
        let mut buffer = Vec::new();
        let mut indices = Vec::new();
        let mut results = Vec::new();
        for (index, fields) in candidates.iter().enumerate() {
            let matches: Vec<_> = fields
                .iter()
                .map(|text| {
                    if needle.is_empty() {
                        return Some(FuzzyMatch {
                            score: 0,
                            positions: vec![],
                        });
                    }
                    indices.clear();
                    let haystack = Utf32Str::new(text, &mut buffer);
                    let score = atom.indices(haystack, matcher, &mut indices)?;
                    indices.sort_unstable();
                    indices.dedup();
                    Some(FuzzyMatch {
                        score,
                        positions: utf16_positions(text, &indices),
                    })
                })
                .collect();
            if let Some(score) = matches.iter().flatten().map(|matched| matched.score).max() {
                results.push(FuzzyResult {
                    index,
                    matches,
                    score,
                });
            }
        }
        // Deterministic title ordering for equal scores and for the empty query.
        results.sort_by_cached_key(|result| {
            (
                std::cmp::Reverse(result.score),
                candidates[result.index]
                    .first()
                    .map(|text| text.to_lowercase())
                    .unwrap_or_default(),
                result.index,
            )
        });
        results
    })
}

fn utf16_positions(text: &str, indices: &[u32]) -> Vec<u32> {
    if text.is_ascii() {
        return indices.to_vec();
    }
    let mut positions = Vec::new();
    let mut offset = 0u32;
    for (index, grapheme) in text.graphemes(true).enumerate() {
        let end = offset + grapheme.encode_utf16().count() as u32;
        if indices.binary_search(&(index as u32)).is_ok() {
            positions.extend(offset..end);
        }
        offset = end;
    }
    positions
}
