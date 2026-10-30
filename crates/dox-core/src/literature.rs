use anyhow::{Result, bail, ensure};
use std::collections::BTreeMap;

/// Keep provider BibTeX intact, replacing only its citation key. Validate the
/// complete entry before allowing it into the library.
pub(crate) fn with_key(source: &str, id: &str) -> Result<String> {
    let source = source.trim().trim_start_matches('\u{feff}').trim();
    let open = source
        .find('{')
        .ok_or_else(|| anyhow::anyhow!("Expected a BibTeX entry"))?;
    let comma = source[open + 1..]
        .find(',')
        .map(|offset| open + 1 + offset)
        .ok_or_else(|| anyhow::anyhow!("Missing BibTeX citation key"))?;
    let source = format!("{}{}{}\n", &source[..open + 1], id, &source[comma..]);
    let fields = parse(&source, id)?;
    ensure!(
        fields
            .get("title")
            .is_some_and(|title| !title.trim().is_empty()),
        "The metadata service returned a reference without a title"
    );
    Ok(source)
}

/// Parse a single, self-contained BibTeX entry. Keep field values intact for Typst.
pub(crate) fn parse(source: &str, id: &str) -> Result<BTreeMap<String, String>> {
    let source = source.trim();
    let open = source
        .find('{')
        .ok_or_else(|| anyhow::anyhow!("Expected a BibTeX entry"))?;
    ensure!(source.starts_with('@'), "Expected a BibTeX entry");
    let kind = source[1..open].trim().to_ascii_lowercase();
    ensure!(
        !matches!(kind.as_str(), "string" | "comment" | "preamble") && !kind.is_empty(),
        "Expected one bibliographic entry"
    );
    let comma = source[open + 1..]
        .find(',')
        .map(|n| n + open + 1)
        .ok_or_else(|| anyhow::anyhow!("Missing citation key"))?;
    ensure!(
        source[open + 1..comma].trim() == id,
        "BibTeX citation key must be {id}"
    );
    let bytes = source.as_bytes();
    let mut pos = comma + 1;
    let mut fields = BTreeMap::new();
    loop {
        while pos < bytes.len() && (bytes[pos].is_ascii_whitespace() || bytes[pos] == b',') {
            pos += 1;
        }
        if bytes.get(pos) == Some(&b'}') {
            ensure!(
                source[pos + 1..].trim().is_empty(),
                "Literature files must contain exactly one entry"
            );
            return Ok(fields);
        }
        let start = pos;
        while pos < bytes.len()
            && (bytes[pos].is_ascii_alphanumeric() || b"_-".contains(&bytes[pos]))
        {
            pos += 1;
        }
        ensure!(pos > start, "Expected BibTeX field name");
        let name = source[start..pos].to_ascii_lowercase();
        while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
            pos += 1;
        }
        ensure!(bytes.get(pos) == Some(&b'='), "Expected '=' after {name}");
        pos += 1;
        let start = pos;
        let mut depth = 0usize;
        let mut quoted = false;
        while pos < bytes.len() {
            match bytes[pos] {
                b'\\' => {
                    pos = (pos + 2).min(bytes.len());
                    continue;
                }
                b'"' if depth == 0 => quoted = !quoted,
                b'{' if !quoted => depth += 1,
                b'}' if !quoted && depth > 0 => depth -= 1,
                b',' | b'}' if !quoted && depth == 0 => break,
                _ => {}
            }
            pos += 1;
        }
        if pos == bytes.len() {
            bail!("Unclosed BibTeX entry or field");
        }
        let value = source[start..pos].trim();
        ensure!(!value.is_empty(), "Empty BibTeX field {name}");
        let value = if (value.starts_with('{') && value.ends_with('}'))
            || (value.starts_with('"') && value.ends_with('"'))
        {
            &value[1..value.len() - 1]
        } else {
            value
        };
        fields.insert(name, value.replace(['{', '}'], ""));
    }
}

/// Render bibliographic data as escaped text, keeping arbitrary fields visible.
pub(crate) fn render(source: &str, id: &str, title: &str) -> Result<String> {
    use crate::escape_html;
    let fields = parse(source, id)?;
    let kind = source
        .trim()
        .split_once('{')
        .map(|(kind, _)| kind.trim_start_matches('@').trim())
        .unwrap_or("Reference");
    let kind = match kind.to_ascii_lowercase().as_str() {
        "article" => "Journal article",
        "inproceedings" | "conference" => "Conference paper",
        "book" => "Book",
        "incollection" | "inbook" => "Book chapter",
        "phdthesis" => "Doctoral thesis",
        "mastersthesis" => "Master’s thesis",
        "techreport" => "Technical report",
        _ => kind,
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
    let mut entries = fields
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
            let separator = regex::Regex::new(r"(?i)\s+and\s+")?;
            let authors = separator
                .split(value)
                .map(str::trim)
                .filter(|author| !author.is_empty())
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
            value.replace(" and ", "; ")
        } else {
            value.clone()
        };
        html.push_str(&format!(
            "<tr><th scope=\"row\">{}</th><td>{}</td></tr>",
            escape_html(&label),
            escape_html(&value)
        ));
    }
    html.push_str("</tbody></table>");
    if let Some(abstract_text) = fields.get("abstract").filter(|text| !text.trim().is_empty()) {
        html.push_str(&format!(
            "<section class=\"literature-abstract\" aria-label=\"Abstract\"><h2>Abstract</h2><p>{}</p></section>",
            escape_html(abstract_text.trim())
        ));
    }
    Ok(html)
}

/// Preserve publication-date precision; never invent a missing month or day.
pub(crate) fn date(fields: &BTreeMap<String, String>) -> Option<String> {
    if let Some(date) = fields.get("date").filter(|date| !date.trim().is_empty()) {
        return Some(date.trim().to_owned());
    }
    let year = fields.get("year")?.trim();
    if year.is_empty() {
        return None;
    }
    let Some(month) = fields.get("month").filter(|month| !month.trim().is_empty()) else {
        return Some(year.to_owned());
    };
    let month = month.trim().to_ascii_lowercase();
    let month_number = month.parse::<u8>().ok().or_else(|| {
        [
            "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
        ]
        .iter()
        .position(|name| month.starts_with(*name))
        .map(|index| index as u8 + 1)
    });
    let Some(month) = month_number else {
        return Some(year.to_owned());
    };
    let Some(day) = fields.get("day").filter(|day| !day.trim().is_empty()) else {
        return Some(format!("{year}-{month:02}"));
    };
    match day.trim().parse::<u8>() {
        Ok(day) => Some(format!("{year}-{month:02}-{day:02}")),
        Err(_) => Some(format!("{year}-{month:02}-{}", day.trim())),
    }
}
