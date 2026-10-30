use anyhow::{Context, Result, ensure};
use biblatex::{Bibliography, ChunksExt, DateValue, Entry, PermissiveType, RawBibliography};
use std::ops::Range;

pub(crate) const CACHE_KEY: &str = "biblatex-0.12-v1";

fn single_entry(source: &str) -> Result<(Entry, Range<usize>)> {
    let raw = RawBibliography::parse(source)
        .map_err(|error| anyhow::anyhow!("Invalid BibTeX: {error}"))?;
    ensure!(
        raw.entries.len() == 1,
        "Literature files must contain exactly one entry"
    );
    let key_span = raw.entries[0].v.key.span.clone();
    let entry = Bibliography::from_raw(raw)
        .map_err(|error| anyhow::anyhow!("Invalid BibTeX: {error}"))?
        .into_vec()
        .pop()
        .context("Expected one bibliographic entry")?;
    Ok((entry, key_span))
}

/// Use the parser's key span to preserve comments, macros and formatting.
pub(crate) fn with_key(source: &str, id: &str) -> Result<String> {
    let (entry, span) = single_entry(source)?;
    ensure!(
        field(&entry, "title").is_some_and(|title| !title.trim().is_empty()),
        "The metadata service returned a reference without a title"
    );
    let mut source = source.to_owned();
    source.replace_range(span, id);
    if !source.ends_with('\n') {
        source.push('\n');
    }
    Ok(source)
}

pub(crate) fn parse(source: &str, id: &str) -> Result<Entry> {
    let (entry, _) = single_entry(source)?;
    ensure!(entry.key == id, "BibTeX citation key must be {id}");
    Ok(entry)
}

/// Display text decoded by biblatex, retaining capitalization and math chunks.
pub(crate) fn field(entry: &Entry, name: &str) -> Option<String> {
    entry.get(name).map(|chunks| chunks.format_verbatim())
}

/// Render bibliographic data as escaped text, keeping arbitrary fields visible.
pub(crate) fn render(source: &str, id: &str, title: &str) -> Result<String> {
    use crate::escape_html;
    let entry = parse(source, id)?;
    let entry_type = entry.entry_type.to_string();
    let kind = match entry_type.as_str() {
        "article" => "Journal article",
        "inproceedings" | "conference" => "Conference paper",
        "book" => "Book",
        "incollection" | "inbook" => "Book chapter",
        "phdthesis" => "Doctoral thesis",
        "mastersthesis" => "Master’s thesis",
        "techreport" => "Technical report",
        _ => entry_type.as_str(),
    };
    let priority = [
        "title",
        "author",
        "editor",
        "date",
        "year",
        "month",
        "day",
        "journal",
        "journaltitle",
        "booktitle",
        "publisher",
        "institution",
        "school",
        "volume",
        "number",
        "pages",
        "edition",
        "series",
        "doi",
        "url",
        "isbn",
        "issn",
        "keywords",
        "note",
    ];
    let mut entries = entry
        .fields
        .iter()
        .filter(|(key, _)| key.as_str() != "abstract")
        .collect::<Vec<_>>();
    let rank = |key: &str| {
        priority
            .iter()
            .position(|name| *name == key)
            .unwrap_or(priority.len())
    };
    entries.sort_by(|(a, _), (b, _)| rank(a).cmp(&rank(b)).then_with(|| a.cmp(b)));
    let mut html = format!(
        "<h1>{}</h1><table class=\"literature-fields\" aria-label=\"Reference details\"><tbody><tr><th scope=\"row\">Publication type</th><td>{}</td></tr>",
        escape_html(title),
        escape_html(kind)
    );
    for (key, value) in entries {
        if key == "author" {
            let authors = entry
                .author()?
                .into_iter()
                .map(|person| person.to_string())
                .collect::<Vec<_>>();
            for (index, author) in authors.iter().enumerate() {
                html.push_str("<tr>");
                if index == 0 {
                    html.push_str(&format!(
                        "<th scope=\"row\" rowspan=\"{}\">Authors</th>",
                        authors.len()
                    ));
                }
                html.push_str(&format!("<td>{}</td></tr>", escape_html(author)));
            }
            continue;
        }
        let label = match key.as_str() {
            "editor" => "Editors".to_owned(),
            "journaltitle" => "Journal".to_owned(),
            "booktitle" => "Book / proceedings".to_owned(),
            "doi" | "url" | "isbn" | "issn" => key.to_uppercase(),
            _ => {
                let label = key.replace(['_', '-'], " ");
                let mut chars = label.chars();
                chars
                    .next()
                    .map(|first| first.to_uppercase().collect::<String>() + chars.as_str())
                    .unwrap_or_default()
            }
        };
        let value = if key == "editor" {
            entry
                .get_as::<Vec<biblatex::Person>>(key)?
                .into_iter()
                .map(|person| person.to_string())
                .collect::<Vec<_>>()
                .join("; ")
        } else {
            value.format_verbatim()
        };
        html.push_str(&format!(
            "<tr><th scope=\"row\">{}</th><td>{}</td></tr>",
            escape_html(&label),
            escape_html(&value)
        ));
    }
    html.push_str("</tbody></table>");
    if let Some(abstract_text) = field(&entry, "abstract").filter(|text| !text.trim().is_empty()) {
        html.push_str(&format!(
            "<section class=\"literature-abstract\" aria-label=\"Abstract\"><h2>Abstract</h2><p>{}</p></section>",
            escape_html(abstract_text.trim())
        ));
    }
    Ok(html)
}

/// Preserve publication-date precision; never invent a missing month or day.
pub(crate) fn date(entry: &Entry) -> Option<String> {
    if let Some(date) = field(entry, "date").filter(|date| !date.trim().is_empty()) {
        // Keep ranges and invalid values visible to the existing date diagnostics.
        return Some(date.trim().to_owned());
    }
    let year = field(entry, "year")?;
    if year.trim().is_empty() {
        return None;
    }
    let month = field(entry, "month");
    // biblatex 0.12 subtracts one from numeric months. Avoid its underflow for
    // zero, preserving the malformed date for dox's date validation instead.
    let parsed = if month
        .as_ref()
        .is_some_and(|month| month.trim().parse::<u8>() == Ok(0))
    {
        None
    } else {
        entry.date().ok()
    };
    if let Some(PermissiveType::Typed(date)) = parsed {
        if let DateValue::At(date) = date.value {
            return Some(date.to_string());
        }
    }
    // Preserve malformed legacy values rather than silently losing their date.
    let mut date = year.trim().to_owned();
    for part in [month, field(entry, "day")] {
        let Some(part) = part.filter(|part| !part.trim().is_empty()) else {
            break;
        };
        date.push('-');
        date.push_str(part.trim());
    }
    Some(date)
}
