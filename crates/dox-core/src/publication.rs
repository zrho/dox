//! Recognize publication identifiers and retrieve metadata before writing files.
use crate::literature;
use anyhow::{Context, Result, bail, ensure};
use percent_encoding::percent_decode_str;
use regex::Regex;
use reqwest::{Url, blocking::Client};
use std::{
    io::Read,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

static DOI: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^10\.\d{4,9}/[^\s]+$").unwrap());
static ARXIV: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r"(?i)^(?:\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}|[a-z][a-z.\-]+/\d{2}(?:0[1-9]|1[0-2])\d{3})(?:v[1-9]\d*)?$"
).unwrap()
});
// arXiv asks clients to leave three seconds between API requests.
static LAST_ARXIV_REQUEST: Mutex<Option<Instant>> = Mutex::new(None);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PublicationIdentifier {
    Doi(String),
    Arxiv(String),
}

impl PublicationIdentifier {
    /// Accept bare identifiers, labelled identifiers, DOI URLs, and arXiv
    /// abstract/PDF/HTML links, including old-style IDs and explicit versions.
    pub fn parse(input: &str) -> Result<Self> {
        let input = input.trim().trim_matches(['<', '>']).trim();
        ensure!(
            !input.is_empty(),
            "Enter a DOI, arXiv ID, or publication link"
        );
        ensure!(
            input.len() <= 4096,
            "The publication identifier is too long"
        );
        let lower = input.to_ascii_lowercase();
        if lower.starts_with("doi:") {
            return Self::doi(input[4..].trim());
        }
        if lower.starts_with("arxiv:") {
            return Self::arxiv(input[6..].trim());
        }
        if DOI.is_match(input) {
            return Self::doi(input);
        }
        if ARXIV.is_match(input) {
            return Self::arxiv(input);
        }
        let url = if lower.starts_with("http://") || lower.starts_with("https://") {
            Url::parse(input)
        } else {
            Url::parse(&format!("https://{input}"))
        };
        if let Ok(url) = url {
            let host = url.host_str().unwrap_or("");
            let path = percent_decode_str(url.path())
                .decode_utf8()
                .context("The link contains invalid text encoding")?;
            let path = path.trim_start_matches('/');
            if matches!(
                host,
                "arxiv.org" | "www.arxiv.org" | "export.arxiv.org" | "ar5iv.labs.arxiv.org"
            ) {
                for prefix in ["abs/", "pdf/", "html/", "e-print/"] {
                    if let Some(id) = path.strip_prefix(prefix) {
                        return Self::arxiv(id.trim_end_matches('/').trim_end_matches(".pdf"));
                    }
                }
            }
            if matches!(host, "doi.org" | "dx.doi.org" | "www.doi.org") {
                return Self::doi(path);
            }
            // Some publisher links include a DOI in their path or query. We
            // still resolve the identifier through doi.org, never scrape them.
            for (name, value) in url.query_pairs() {
                if name.eq_ignore_ascii_case("doi") && DOI.is_match(&value) {
                    return Self::doi(&value);
                }
            }
            for (start, _) in path.match_indices("10.") {
                if DOI.is_match(&path[start..]) {
                    return Self::doi(&path[start..]);
                }
            }
        }
        bail!(
            "Couldn't recognize this publication. Enter a DOI (10.…/…), an arXiv ID, or a DOI/arXiv link. Import one publication at a time."
        )
    }

    fn doi(doi: &str) -> Result<Self> {
        ensure!(
            DOI.is_match(doi),
            "This doesn't look like a DOI; expected 10.…/…"
        );
        let lower = doi.to_ascii_lowercase();
        if lower.starts_with("10.48550/arxiv.") {
            return Self::arxiv(&doi[15..]);
        }
        Ok(Self::Doi(doi.to_owned()))
    }

    fn arxiv(id: &str) -> Result<Self> {
        ensure!(
            ARXIV.is_match(id),
            "This doesn't look like an arXiv ID; expected YYMM.NNNNN or archive/YYMMNNN, optionally followed by v1, v2, …"
        );
        Ok(Self::Arxiv(id.to_ascii_lowercase()))
    }
}

pub(crate) fn lookup(input: &str) -> Result<String> {
    let identifier = PublicationIdentifier::parse(input)?;
    let client = Client::builder()
        .user_agent(concat!(
            "dox/",
            env!("CARGO_PKG_VERSION"),
            " (publication metadata import)"
        ))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .https_only(true)
        .build()
        .context("Couldn't initialize publication lookup")?;
    let bibtex = match identifier {
        PublicationIdentifier::Doi(doi) => {
            let mut url = Url::parse("https://doi.org/")?;
            url.path_segments_mut().unwrap().extend(doi.split('/'));
            download(&client, url, "application/x-bibtex", &format!("DOI {doi}"))?
        }
        PublicationIdentifier::Arxiv(id) => {
            {
                let mut last = LAST_ARXIV_REQUEST
                    .lock()
                    .map_err(|_| anyhow::anyhow!("arXiv lookup is unavailable"))?;
                if let Some(previous) = *last {
                    std::thread::sleep(Duration::from_secs(3).saturating_sub(previous.elapsed()));
                }
                *last = Some(Instant::now());
            }
            let mut url = Url::parse("https://export.arxiv.org/api/query")?;
            url.query_pairs_mut()
                .append_pair("id_list", &id)
                .append_pair("max_results", "1");
            let xml = download(&client, url, "application/atom+xml", &format!("arXiv:{id}"))?;
            arxiv_bibtex(&xml, &id)?
        }
    };
    literature::with_key(&bibtex, "IMPORT")
        .context("The metadata service didn't return a usable single-entry BibTeX reference")
}

fn download(client: &Client, url: Url, accept: &str, label: &str) -> Result<String> {
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, accept)
        .send()
        .with_context(|| {
            format!("Couldn't look up {label}. Check your internet connection and try again")
        })?;
    match response.status().as_u16() {
        404 => bail!("No publication was found for {label}"),
        429 => bail!("The metadata service is receiving too many requests. Try again shortly"),
        _ => {}
    }
    let response = response
        .error_for_status()
        .with_context(|| format!("The metadata service couldn't look up {label}"))?;
    const MAX_BYTES: u64 = 2 * 1024 * 1024;
    let mut bytes = Vec::new();
    response
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .context("The publication metadata couldn't be downloaded")?;
    ensure!(
        bytes.len() as u64 <= MAX_BYTES,
        "The metadata service returned an unexpectedly large response"
    );
    String::from_utf8(bytes).context("The metadata service returned invalid UTF-8 text")
}

fn arxiv_bibtex(xml: &str, id: &str) -> Result<String> {
    const ATOM: &str = "http://www.w3.org/2005/Atom";
    const ARXIV_NS: &str = "http://arxiv.org/schemas/atom";
    let document = roxmltree::Document::parse(xml).context("arXiv returned invalid metadata")?;
    let entry = document
        .descendants()
        .find(|node| node.has_tag_name((ATOM, "entry")))
        .with_context(|| format!("No arXiv publication was found for {id}"))?;
    let text = |namespace, name| {
        entry
            .children()
            .find(|node| node.has_tag_name((namespace, name)))
            .and_then(|node| node.text())
            .unwrap_or("")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    };
    let returned_id = text(ATOM, "id");
    let returned_id = PublicationIdentifier::parse(&returned_id)
        .with_context(|| format!("arXiv couldn't find publication {id}"))?;
    let PublicationIdentifier::Arxiv(returned_id) = returned_id else {
        bail!("arXiv returned metadata for an unexpected publication");
    };
    let unversioned = |value: &str| {
        value
            .rsplit_once('v')
            .filter(|(_, version)| {
                !version.is_empty() && version.bytes().all(|byte| byte.is_ascii_digit())
            })
            .map_or(value, |(id, _)| id)
            .to_owned()
    };
    ensure!(
        unversioned(&returned_id) == unversioned(id)
            && (unversioned(id) == id || returned_id == id),
        "arXiv returned metadata for an unexpected publication"
    );
    let title = text(ATOM, "title");
    ensure!(
        !title.is_empty(),
        "arXiv returned a publication without a title"
    );
    let authors = entry
        .children()
        .filter(|node| node.has_tag_name((ATOM, "author")))
        .filter_map(|author| {
            author
                .children()
                .find(|node| node.has_tag_name((ATOM, "name")))
                .and_then(|node| node.text())
        })
        .map(|name| name.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect::<Vec<_>>()
        .join(" and ");
    let mut fields = vec![
        ("title", title),
        ("author", authors),
        ("eprint", id.to_owned()),
        ("archiveprefix", "arXiv".to_owned()),
        ("url", format!("https://arxiv.org/abs/{id}")),
    ];
    let published = text(ATOM, "published");
    if let Some(date) = published
        .get(..10)
        .and_then(|date| date.parse::<jiff::civil::Date>().ok())
    {
        fields.push(("date", date.to_string()));
        fields.push(("year", date.year().to_string()));
    }
    if let Some(category) = entry
        .children()
        .find(|node| node.has_tag_name((ARXIV_NS, "primary_category")))
        .and_then(|node| node.attribute("term"))
    {
        fields.push(("primaryclass", category.to_owned()));
    }
    fields.extend([
        ("doi", text(ARXIV_NS, "doi")),
        ("note", text(ARXIV_NS, "journal_ref")),
        ("abstract", text(ATOM, "summary")),
    ]);
    let mut bibtex = String::from("@misc{IMPORT,\n");
    for (name, value) in fields.into_iter().filter(|(_, value)| !value.is_empty()) {
        bibtex.push_str(&format!("  {name} = {{{value}}},\n"));
    }
    bibtex.push_str("}\n");
    Ok(bibtex)
}
