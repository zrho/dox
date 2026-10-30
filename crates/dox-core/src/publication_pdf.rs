//! Resolve a publication to a supported PDF source, then download and attach it.
//! Provider dispatch lives here; attachment storage stays independent of sources.
use crate::{Attachment, Library, PublicationIdentifier, literature, publication};
use anyhow::{Context, Result, bail, ensure};
use publication::{ARXIV_NS, ATOM};
use reqwest::Url;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Seek, SeekFrom},
    time::Duration,
};
use tempfile::NamedTempFile;

pub(crate) enum PdfSource {
    Arxiv(String),
}

impl PdfSource {
    pub(crate) fn from_fields(fields: &BTreeMap<String, String>) -> Option<Self> {
        let arxiv = |value: &str| match PublicationIdentifier::parse(value).ok()? {
            PublicationIdentifier::Arxiv(id) => Some(Self::Arxiv(id)),
            _ => None,
        };
        for key in ["arxiv", "arxivid", "arxiv_id"] {
            if let Some(pdf) = fields.get(key).and_then(|value| arxiv(value)) {
                return Some(pdf);
            }
        }
        let archive = fields
            .get("archiveprefix")
            .or_else(|| fields.get("eprinttype"));
        if archive.is_none_or(|archive| archive.trim().eq_ignore_ascii_case("arxiv")) {
            if let Some(pdf) = fields.get("eprint").and_then(|value| arxiv(value)) {
                return Some(pdf);
            }
        }
        for key in ["url", "doi"] {
            if let Some(pdf) = fields.get(key).and_then(|value| arxiv(value)) {
                return Some(pdf);
            }
        }
        None
    }

    fn find(fields: &BTreeMap<String, String>) -> Result<Self> {
        if let Some(pdf) = Self::from_fields(fields) {
            return Ok(pdf);
        }
        if let Some(id) = search_arxiv(fields)? {
            return Ok(Self::Arxiv(id));
        }
        bail!(
            "No matching arXiv PDF was found. Add an arXiv URL, arXiv DOI, or eprint with archiveprefix = {{arXiv}} to this item's BibTeX and try again."
        )
    }

    fn filename(&self) -> String {
        match self {
            Self::Arxiv(id) => format!("arxiv-{}.pdf", id.replace('/', "-")),
        }
    }

    fn download(&self) -> Result<NamedTempFile> {
        let url = match self {
            Self::Arxiv(id) => Url::parse(&format!("https://arxiv.org/pdf/{id}"))?,
        };
        let client = publication::client(Duration::from_secs(120))?;
        let response = client
            .get(url)
            .header(reqwest::header::ACCEPT, "application/pdf")
            .send()
            .context("Couldn't download the paper PDF. Check your connection and try again")?;
        match response.status().as_u16() {
            404 => bail!("The paper PDF is not available on arXiv"),
            429 => bail!("arXiv is receiving too many requests. Try again shortly"),
            _ => {}
        }
        let response = response
            .error_for_status()
            .context("The PDF source returned an error")?;
        const MAX_BYTES: u64 = 100 * 1024 * 1024;
        ensure!(
            response
                .content_length()
                .is_none_or(|size| size <= MAX_BYTES),
            "The paper PDF exceeds the 100 MB download limit"
        );
        let mut file = NamedTempFile::new().context("Couldn't create a temporary PDF file")?;
        let size = std::io::copy(&mut response.take(MAX_BYTES + 1), &mut file)
            .context("The PDF download was interrupted")?;
        ensure!(
            size <= MAX_BYTES,
            "The paper PDF exceeds the 100 MB download limit"
        );
        ensure!(
            size >= 10,
            "The PDF source returned an empty or incomplete document"
        );
        file.seek(SeekFrom::Start(0))?;
        let mut signature = [0; 5];
        file.read_exact(&mut signature)?;
        ensure!(
            &signature == b"%PDF-",
            "The PDF source returned a page instead of a PDF. Try again later"
        );
        file.seek(SeekFrom::Start(size.saturating_sub(1024)))?;
        let mut tail = vec![];
        file.read_to_end(&mut tail)?;
        ensure!(
            tail.windows(5).any(|bytes| bytes == b"%%EOF"),
            "The PDF source returned an incomplete document"
        );
        Ok(file)
    }
}

fn normalized(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn doi(value: &str) -> Option<String> {
    match PublicationIdentifier::parse(value).ok()? {
        PublicationIdentifier::Doi(value) => Some(value.to_ascii_lowercase()),
        _ => None,
    }
}

fn text(node: roxmltree::Node<'_, '_>, namespace: &str, name: &str) -> String {
    node.children()
        .find(|child| child.has_tag_name((namespace, name)))
        .and_then(|child| child.text())
        .unwrap_or("")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Search by title using the documented arXiv API fields, then prefer exact DOI
/// matches. Otherwise require an exact title and an author surname when known;
/// ambiguous matches are rejected.
fn search_arxiv(fields: &BTreeMap<String, String>) -> Result<Option<String>> {
    let title = fields
        .get("title")
        .map(|value| normalized(value))
        .unwrap_or_default();
    let expected_doi = fields.get("doi").and_then(|value| doi(value));
    if title.len() < 12 {
        return Ok(None);
    }
    let author_separator = regex::Regex::new(r"(?i)\s+and\s+")?;
    let surname = fields
        .get("author")
        .and_then(|authors| author_separator.split(authors).next())
        .map(|author| {
            author
                .split_once(',')
                .map(|(family, _)| family)
                .unwrap_or_else(|| author.split_whitespace().last().unwrap_or(""))
        })
        .map(normalized)
        .filter(|name| !name.is_empty());
    let client = publication::client(Duration::from_secs(30))?;
    let query = format!("ti:\"{}\"", fields["title"].replace(['"', '\\'], " "));
    let xml = publication::arxiv_query(&client, &[("search_query", &query), ("max_results", "5")])?;
    let document =
        roxmltree::Document::parse(&xml).context("arXiv returned invalid search results")?;
    let mut doi_matches = vec![];
    let mut title_matches = vec![];
    for entry in document
        .descendants()
        .filter(|node| node.has_tag_name((ATOM, "entry")))
    {
        let matches_doi = expected_doi
            .as_ref()
            .is_some_and(|expected| doi(&text(entry, ARXIV_NS, "doi")).as_ref() == Some(expected));
        let matches_title = normalized(&text(entry, ATOM, "title")) == title;
        let matches_author = surname.as_ref().is_none_or(|surname| {
            entry
                .children()
                .filter(|child| child.has_tag_name((ATOM, "author")))
                .any(|author| {
                    let name = text(author, ATOM, "name");
                    normalized(&name).ends_with(surname)
                        || name
                            .split_whitespace()
                            .any(|word| normalized(word) == *surname)
                })
        });
        if !(matches_doi || (matches_title && matches_author)) {
            continue;
        }
        if let Ok(PublicationIdentifier::Arxiv(id)) =
            PublicationIdentifier::parse(&text(entry, ATOM, "id"))
        {
            let matches = if matches_doi {
                &mut doi_matches
            } else {
                &mut title_matches
            };
            if !matches.contains(&id) {
                matches.push(id);
            }
        }
    }
    let mut matches = if !doi_matches.is_empty() {
        doi_matches
    } else {
        title_matches
    };
    ensure!(
        matches.len() <= 1,
        "Several arXiv papers matched this reference. Add an explicit arXiv URL or eprint to choose the right one"
    );
    Ok(matches.pop())
}

fn file_hash(file: &mut fs::File) -> Result<Vec<u8>> {
    file.seek(SeekFrom::Start(0))?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let size = file.read(&mut buffer)?;
        if size == 0 {
            break;
        }
        hash.update(&buffer[..size]);
    }
    Ok(hash.finalize().to_vec())
}

impl Library {
    /// Search supported providers using the supplied draft, or saved BibTeX when
    /// absent. Never modify the source or its revision when attaching a PDF.
    pub fn find_paper_pdf(&self, id: &str, source: Option<&str>) -> Result<Attachment> {
        let (path, metadata) = self.paths(id)?;
        ensure!(
            metadata.kind == "literature",
            "Paper PDF lookup is only available for literature items"
        );
        let source = match source {
            Some(source) => source.to_owned(),
            None => fs::read_to_string(path)?,
        };
        let fields = literature::parse(&source, id)?;
        let pdf = PdfSource::find(&fields)?;
        self.attach_paper_pdf(id, &pdf)
    }

    pub(crate) fn attach_paper_pdf(&self, id: &str, source: &PdfSource) -> Result<Attachment> {
        let mut file = source.download()?;
        let size = file.as_file().metadata()?.len();
        let hash = file_hash(file.as_file_mut())?;
        for attachment in self.attachments(id)? {
            if attachment.size != size || !attachment.name.to_ascii_lowercase().ends_with(".pdf") {
                continue;
            }
            if let Ok(path) = self.attachment_path(id, &attachment.name)
                && let Ok(mut existing) = fs::File::open(path)
                && file_hash(&mut existing).is_ok_and(|existing_hash| existing_hash == hash)
            {
                return Ok(attachment);
            }
        }
        file.seek(SeekFrom::Start(0))?;
        self.attach_reader(id, &source.filename(), file)
    }
}
