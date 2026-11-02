//! Filesystem libraries shared by the desktop app and CLI.
mod attachments;
mod compiler;
pub use attachments::Attachment;
mod diagnostics;
mod fuzzy;
pub use fuzzy::{FuzzyMatch, FuzzyResult, fuzzy_find};
mod literature;
mod publication;
mod publication_pdf;
use anyhow::{Context, Result, bail, ensure};
pub use diagnostics::{Diagnostic, DiagnosticAction, Severity};
use dom_query::Document as HtmlDocument;
use notify::{RecursiveMode, Watcher};
pub use publication::{PublicationIdentifier, PublicationImport};
use rand::Rng;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use std::{
    collections::{BTreeSet, HashMap},
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    time::SystemTime,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metadata {
    #[serde(rename = "type")]
    pub kind: String,
    pub document: String,
    #[serde(flatten)]
    pub fields: Map<String, Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub metadata: Metadata,
    /// Typst markup used when inserting a link label.
    pub title: String,
    /// Compiled inline HTML/MathML, absent until compilation succeeds.
    #[serde(default)]
    pub title_html: Option<String>,
    /// Plain compiled text for search, sorting, and accessibility.
    #[serde(default)]
    pub title_text: String,
    pub tags: Vec<String>,
    pub links: Vec<String>,
    pub revision: String,
    pub diagnostic: Option<String>,
    #[serde(default)]
    pub diagnostics: Vec<Diagnostic>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteDocument {
    pub note: Note,
    pub source: String,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryIndex {
    pub notes: Vec<Note>,
    pub warnings: Vec<String>,
    pub diagnostics: Vec<Diagnostic>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletedNote {
    pub id: String,
    pub trash_entry: String,
}
#[derive(Debug, Clone)]
pub struct Library {
    root: PathBuf,
    compiler: Arc<compiler::Compiler>,
    note_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct FileStamp {
    path: PathBuf,
    len: u64,
    modified: SystemTime,
}
impl FileStamp {
    fn read(path: PathBuf) -> Result<Self> {
        let metadata = fs::metadata(&path)?;
        Ok(Self {
            path,
            len: metadata.len(),
            modified: metadata.modified()?,
        })
    }
    fn unchanged(&self) -> bool {
        Self::read(self.path.clone()).is_ok_and(|current| current == *self)
    }
}
#[derive(Serialize, Deserialize)]
struct CachedNote {
    version: u32,
    compiler_key: String,
    dependencies: Option<Vec<FileStamp>>,
    failed_fingerprint: Option<String>,
    note: Note,
}
const SVG_MATH: &str = include_str!("math-svg.typ");

fn compiler_key() -> String {
    let mut settings = std::env::vars_os()
        .filter(|(key, _)| {
            let key = key.to_string_lossy();
            key.starts_with("TYPST_") || key == "SOURCE_DATE_EPOCH"
        })
        .collect::<Vec<_>>();
    settings.sort();
    digest(
        format!(
            "note-ids-v2:{}:{}:{SVG_MATH}:{settings:?}",
            compiler::VERSION,
            literature::CACHE_KEY
        )
        .as_bytes(),
    )
}

pub fn valid_id(id: &str) -> bool {
    (id.len() == 5
        && id
            .bytes()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()))
        || (id.len() == 10 && valid_date(id))
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut tmp = tempfile::NamedTempFile::new_in(path.parent().context("Missing parent")?)?;
    tmp.write_all(bytes)?;
    tmp.as_file().sync_all()?;
    tmp.persist(path).map_err(|e| e.error)?;
    Ok(())
}
fn valid_date(value: &str) -> bool {
    let expanded = match value.len() {
        4 if value.bytes().all(|b| b.is_ascii_digit()) => format!("{value}-01-01"),
        7 => format!("{value}-01"),
        10 => value.to_owned(),
        _ => return false,
    };
    expanded
        .parse::<jiff::civil::Date>()
        .is_ok_and(|date| date.to_string() == expanded)
}

fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
fn strings(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(v)) => v
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        Some(Value::String(v)) => vec![v.clone()],
        _ => vec![],
    }
}
impl Library {
    pub fn init(path: impl AsRef<Path>) -> Result<Self> {
        fs::create_dir_all(path.as_ref())?;
        let lib = Self::open(path)?;
        let ignore = lib.root.join(".gitignore");
        let mut text = fs::read_to_string(&ignore).unwrap_or_default();
        for rule in ["/.cache/", "/.trash/"] {
            if !text.lines().any(|line| line == rule) {
                if !text.is_empty() && !text.ends_with('\n') {
                    text.push('\n');
                }
                text.push_str(rule);
                text.push('\n');
            }
        }
        if fs::read_to_string(&ignore).ok().as_deref() != Some(text.as_str()) {
            atomic_write(&ignore, text.as_bytes())?;
        }
        Ok(lib)
    }
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let root = path
            .as_ref()
            .canonicalize()
            .context("Library directory does not exist")?;
        ensure!(root.is_dir(), "Library must be a directory");
        Ok(Self {
            compiler: Arc::new(compiler::Compiler::new(root.clone())),
            root,
            note_locks: Arc::new(Mutex::new(HashMap::new())),
        })
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
    fn note_dir(&self, id: &str) -> Result<PathBuf> {
        ensure!(valid_id(id), "Invalid note ID: {id}");
        let dir = self
            .root
            .join(id)
            .canonicalize()
            .context("Note does not exist")?;
        ensure!(
            dir.starts_with(&self.root),
            "Note directory escapes library"
        );
        Ok(dir)
    }
    fn paths(&self, id: &str) -> Result<(PathBuf, Metadata)> {
        let dir = self.note_dir(id)?;
        let meta_path = dir.join("meta.json").canonicalize()?;
        ensure!(
            meta_path.starts_with(&dir),
            "Metadata escapes note directory"
        );
        let meta: Metadata =
            serde_json::from_slice(&fs::read(meta_path)?).context("Invalid meta.json")?;
        ensure!(!meta.kind.is_empty(), "Note type must not be empty");
        let rel = Path::new(&meta.document);
        ensure!(
            !rel.as_os_str().is_empty()
                && rel.components().all(|c| matches!(c, Component::Normal(_))),
            "Document must be a relative path within its note"
        );
        let doc = dir
            .join(rel)
            .canonicalize()
            .context("Source document is missing")?;
        ensure!(
            doc.starts_with(&dir),
            "Source document escapes note directory"
        );
        Ok((doc, meta))
    }
    /// Stable generated wrapper preserves the original document's relative imports.
    fn citation_document(&self, doc: &Path) -> Result<PathBuf> {
        let relative_doc = doc.strip_prefix(&self.root)?;
        let id = relative_doc
            .components()
            .next()
            .and_then(|c| c.as_os_str().to_str())
            .unwrap_or("");
        if !valid_id(id) {
            return Ok(doc.to_owned());
        }
        let mut entries = vec![];
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let key = entry.file_name().to_string_lossy().into_owned();
            if !valid_id(&key) {
                continue;
            }
            if let Ok((path, meta)) = self.paths(&key) {
                if meta.kind == "literature" {
                    if let Ok(source) = fs::read_to_string(path) {
                        if let Ok(entry) = literature::parse(&source, &key) {
                            // Expand per-item macros so definitions from separate
                            // files cannot collide in the shared bibliography.
                            entries.push((key, entry.to_biblatex_string()));
                        }
                    }
                }
            }
        }
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let cache = self.root.join(".cache").join(id);
        fs::create_dir_all(&cache)?;
        let bib = entries
            .iter()
            .map(|(_, source)| source.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        let bib_path = cache.join("literature.bib");
        if fs::read_to_string(&bib_path).ok().as_deref() != Some(&bib) {
            atomic_write(&bib_path, bib.as_bytes())?;
        }
        let relative = doc.strip_prefix(&self.root)?.to_string_lossy();
        let mut wrapper = format!(
            "{SVG_MATH}\n#include {}\n",
            serde_json::to_string(&format!("/{relative}"))?
        );
        if !entries.is_empty() {
            let keys = entries
                .iter()
                .map(|(key, _)| format!("\"{key}\""))
                .collect::<Vec<_>>()
                .join(",");
            wrapper = format!(
                "#show bibliography: none\n#show cite: it => if str(it.key) in ({keys},) {{ link(\"dox:\" + str(it.key), {{ show link: l => l.body; it }}) }} else {{ it }}\n{wrapper}#bibliography(\"literature.bib\", title: none)\n"
            );
        }
        let path = cache.join("document.typ");
        if fs::read_to_string(&path).ok().as_deref() != Some(&wrapper) {
            atomic_write(&path, wrapper.as_bytes())?;
        }
        Ok(path)
    }
    fn fingerprint(&self) -> Result<String> {
        fn visit(path: &Path, hash: &mut Sha256) -> Result<()> {
            let mut entries = fs::read_dir(path)?.collect::<std::io::Result<Vec<_>>>()?;
            entries.sort_by_key(|e| e.file_name());
            for entry in entries {
                let name = entry.file_name();
                if name == ".cache" || name == ".git" || name == ".trash" {
                    continue;
                }
                hash.update(name.to_string_lossy().as_bytes());
                let meta = fs::symlink_metadata(entry.path())?;
                if meta.is_dir() {
                    visit(&entry.path(), hash)?;
                } else {
                    hash.update(meta.len().to_le_bytes());
                    hash.update(format!("{:?}", meta.modified()?));
                }
            }
            Ok(())
        }
        let mut hash = Sha256::new();
        hash.update(b"dox-index-v4-link-validation");
        hash.update(compiler::VERSION.as_bytes());
        visit(&self.root, &mut hash)?;
        Ok(format!("{:x}", hash.finalize()))
    }
    pub fn read(&self, id: &str) -> Result<NoteDocument> {
        self.read_with_context(id, None, None)
    }
    fn read_with_context(
        &self,
        id: &str,
        library_fingerprint: Option<&str>,
        compiler: Option<&str>,
    ) -> Result<NoteDocument> {
        ensure!(valid_id(id), "Invalid note ID: {id}");
        let lock = self
            .note_locks
            .lock()
            .map_err(|_| anyhow::anyhow!("Note lock unavailable"))?
            .entry(id.into())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();
        let _guard = lock
            .lock()
            .map_err(|_| anyhow::anyhow!("Note lock unavailable"))?;
        let (path, explicit) = self.paths(id)?;
        let source = fs::read_to_string(&path)?;
        if explicit.kind == "typst" {
            self.citation_document(&path)?;
        }
        let revision = digest(
            [source.as_bytes(), &serde_json::to_vec(&explicit)?]
                .concat()
                .as_slice(),
        );
        let compiler = compiler.map(str::to_owned).unwrap_or_else(compiler_key);
        let cache = self.root.join(".cache").join(id);
        if let Ok(bytes) = fs::read(cache.join("metadata.json"))
            && let Ok(mut entry) = serde_json::from_slice::<CachedNote>(&bytes)
            && entry.version == 1
            && entry.compiler_key == compiler
            && entry.note.revision == revision
        {
            let fresh = if let Some(failed) = &entry.failed_fingerprint {
                let fingerprint = match library_fingerprint {
                    Some(key) => key.to_owned(),
                    None => self.fingerprint()?,
                };
                *failed == fingerprint
            } else {
                entry
                    .dependencies
                    .as_ref()
                    .is_some_and(|deps| deps.iter().all(FileStamp::unchanged))
            };
            if fresh {
                self.refresh_link_diagnostics(&mut entry.note, &source);
                return Ok(NoteDocument {
                    note: entry.note,
                    source,
                    attachments: self.attachments(id)?,
                });
            }
        }
        let mut metadata = explicit.clone();
        if matches!(explicit.kind.as_str(), "typst" | "literature") {
            metadata.fields.remove("date");
        }
        let mut diagnostic = None;
        let mut diagnostics = vec![];
        let mut links = BTreeSet::new();
        let mut link_destinations = BTreeSet::new();
        let mut compiled = None;
        let mut title_dependencies = Some(vec![]);
        if explicit.kind == "typst" {
            match self.compile_document(&path, id, &mut diagnostics) {
                Ok(output) => {
                    let mut derived = Map::new();
                    let mut source_date = None;
                    for item in &output.metadata {
                        if item.get("label").and_then(Value::as_str) == Some("<dox-date>") {
                            source_date = item.get("value").cloned();
                        }
                        if item.get("label").and_then(Value::as_str) == Some("<dox>")
                            && let Some(fields) = item.get("value").and_then(Value::as_object)
                        {
                            derived.extend(fields.clone());
                        }
                    }
                    let date = source_date.or_else(|| derived.remove("date"));
                    derived.extend(explicit.fields.clone());
                    derived.remove("date");
                    if let Some(date) = date.filter(|date| !date.is_null()) {
                        derived.insert("date".into(), date);
                    }
                    metadata.fields = derived;
                    compiled = Some(output);
                }
                Err(error) => diagnostic = Some(error.to_string()),
            }
        }

        if explicit.kind == "literature" {
            match literature::parse(&source, id) {
                Ok(entry) => {
                    if let Some(date) = literature::date(&entry) {
                        metadata.fields.insert("date".into(), json!(date));
                    }
                    for key in ["title", "author", "year", "doi", "url"] {
                        if let Some(value) = literature::field(&entry, key) {
                            metadata
                                .fields
                                .entry(key.to_owned())
                                .or_insert(json!(value));
                        }
                    }
                }
                Err(error) => {
                    diagnostic = Some(error.to_string());
                    diagnostics.push(Diagnostic::new(
                        Severity::Error,
                        "invalid-bibtex",
                        id,
                        Some(&explicit.document),
                        error.to_string(),
                    ));
                }
            }
        }
        let metadata_title = metadata.fields.get("title").and_then(Value::as_str);
        let heading_source = source
            .lines()
            .find_map(|line| line.strip_prefix("= ").map(str::to_owned));
        let mut title = metadata_title
            .map(str::to_owned)
            .or_else(|| heading_source.clone())
            .unwrap_or_else(|| id.to_owned());
        let mut title_text = title.clone();
        let mut title_html = None;
        if explicit.kind == "typst" && diagnostic.is_none() {
            match compiled
                .as_ref()
                .map(|output| output.html.clone())
                .context("Missing compiled note")
            {
                Ok(html) => {
                    fs::create_dir_all(&cache)?;
                    atomic_write(&cache.join("note.html"), html.as_bytes())?;
                    let document = HtmlDocument::from(html.as_str());
                    // Include links emitted by HTML show rules, not only Typst link elements.
                    for anchor in document.select("a[href]").nodes() {
                        if let Some(destination) = anchor.attr("href") {
                            link_destinations.insert(destination.to_string());
                        }
                    }
                    // Typst exports #title as h1, and a level-one heading as h2.
                    let heading = document.select_single("h1");
                    let heading = if heading.exists() {
                        heading
                    } else {
                        document.select_single("h2")
                    };
                    let rendered = if let Some(markup) = metadata_title.filter(|markup| {
                        !heading.exists() || Some(*markup) != heading_source.as_deref()
                    }) {
                        self.compile_title(markup, id, &mut diagnostics, &mut title_dependencies)
                    } else if heading.exists() {
                        Ok((
                            heading.inner_html().to_string(),
                            if heading.select("svg").exists() {
                                // SVG glyphs have no text nodes. Retain heading source
                                // for search, and compiled prose for computed #title.
                                heading_source
                                    .clone()
                                    .unwrap_or_else(|| heading.text().to_string())
                            } else {
                                heading.text().to_string()
                            },
                        ))
                    } else {
                        Ok((escape_html(&title), title.clone()))
                    };
                    match rendered {
                        Ok((html, text)) => {
                            if metadata_title.is_none()
                                && !source.lines().any(|line| line.starts_with("= "))
                            {
                                title = text.clone();
                            }
                            title_html = Some(html);
                            title_text = text;
                        }
                        Err(error) => diagnostic = Some(format!("Title: {error:#}")),
                    }
                }
                Err(error) => diagnostic = Some(error.to_string()),
            }
        }
        if let Some(html) = &title_html {
            atomic_write(&cache.join("title.html"), html.as_bytes())?;
        }
        if let Some(message) = &diagnostic {
            if !diagnostics.iter().any(|d| d.severity == Severity::Error) {
                diagnostics.push(Diagnostic::new(
                    Severity::Error,
                    "typst-compile",
                    id,
                    Some(&explicit.document),
                    message.clone(),
                ));
            }
        }
        if explicit.kind == "typst" && diagnostic.is_some() {
            let re = Regex::new(r#"#link\(\s*"(dox:[^"\r\n]*)""#)?;
            for capture in re.captures_iter(&source) {
                link_destinations.insert(capture[1].to_owned());
            }
        }
        if explicit.kind == "typst" {
            if let Some(output) = &compiled {
                for item in &output.citations {
                    if let Some(key) = item.get("key").and_then(Value::as_str) {
                        let key = key.trim_matches(['<', '>']);
                        if valid_id(key) {
                            link_destinations.insert(format!("dox:{key}"));
                        }
                    }
                }
            }
            if diagnostic.is_some() {
                for capture in Regex::new(r"@([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9A-Z]{5})\b")?
                    .captures_iter(&source)
                {
                    if valid_id(&capture[1]) {
                        link_destinations.insert(format!("dox:{}", &capture[1]));
                    }
                }
            }
        }
        // Validate every internal destination before accepting it into the graph.
        // In particular, malformed IDs must not disappear through a filter.
        for destination in &link_destinations {
            let Some(target) = destination.strip_prefix("dox:") else {
                continue;
            };
            let mut issue = if !valid_id(target) {
                Some(Diagnostic::new(
                    Severity::Error,
                    "invalid-note-link",
                    id,
                    Some(&explicit.document),
                    format!(
                        "Invalid note link '{destination}': expected dox: followed by five uppercase letters or digits, or a valid YYYY-MM-DD date"
                    ),
                ))
            } else {
                links.insert(target.to_owned());
                None
            };
            if let Some(issue) = &mut issue {
                issue.target_note_id = Some(target.into());
                if let Some(offset) = source.find(destination.as_str()) {
                    issue.line = Some(
                        source[..offset]
                            .bytes()
                            .filter(|byte| *byte == b'\n')
                            .count()
                            + 1,
                    );
                    issue.column = Some(
                        source[..offset]
                            .rsplit('\n')
                            .next()
                            .unwrap_or("")
                            .chars()
                            .count()
                            + 1,
                    );
                }
            }
            if let Some(issue) = issue {
                diagnostics.push(issue);
            }
        }
        if explicit.kind != "typst" && explicit.kind != "literature" {
            diagnostics.push(Diagnostic::new(
                Severity::Warning,
                "unsupported-note-type",
                id,
                Some(&explicit.document),
                format!("Viewing note type '{}' is not supported yet", explicit.kind),
            ));
        }
        if let Some(date) = metadata.fields.get("date") {
            if !date.as_str().is_some_and(valid_date) {
                diagnostics.push(Diagnostic::new(
                    Severity::Warning,
                    "invalid-date",
                    id,
                    Some(&explicit.document),
                    "Date should be a valid YYYY, YYYY-MM, or YYYY-MM-DD string",
                ));
            }
        }
        diagnostics.sort_by(|a, b| a.id.cmp(&b.id));
        diagnostics.dedup_by(|a, b| a.id == b.id);
        let tags = strings(metadata.fields.get("tags"));
        let mut note = Note {
            id: id.to_owned(),
            metadata,
            title,
            title_html,
            title_text,
            tags,
            links: links.into_iter().collect(),
            revision,
            diagnostic,
            diagnostics,
        };
        self.refresh_link_diagnostics(&mut note, &source);
        let failed_fingerprint = if note.diagnostic.is_some() {
            Some(match library_fingerprint {
                Some(key) => key.to_owned(),
                None => self.fingerprint()?,
            })
        } else {
            None
        };
        let dependencies = if explicit.kind != "typst" {
            Some(vec![])
        } else {
            compiled
                .take()
                .and_then(|output| output.dependencies)
                .and_then(|mut dependencies| {
                    dependencies.extend(title_dependencies?);
                    Some(dependencies)
                })
        };
        let entry = CachedNote {
            version: 1,
            compiler_key: compiler,
            dependencies,
            failed_fingerprint,
            note: note.clone(),
        };
        fs::create_dir_all(&cache)?;
        atomic_write(&cache.join("metadata.json"), &serde_json::to_vec(&entry)?)?;
        Ok(NoteDocument {
            note,
            source,
            attachments: self.attachments(id)?,
        })
    }
    fn refresh_link_diagnostics(&self, note: &mut Note, source: &str) {
        note.diagnostics
            .retain(|issue| issue.code != "dangling-link");
        for target in &note.links {
            if let Err(error) = self.paths(target) {
                let mut issue = Diagnostic::new(
                    Severity::Error,
                    "dangling-link",
                    &note.id,
                    Some(&note.metadata.document),
                    format!("Link target {target} is missing or unreadable: {error:#}"),
                );
                issue.target_note_id = Some(target.clone());
                if let Some(offset) = source.find(&format!("dox:{target}")) {
                    issue.line = Some(
                        source[..offset]
                            .bytes()
                            .filter(|byte| *byte == b'\n')
                            .count()
                            + 1,
                    );
                    issue.column = Some(
                        source[..offset]
                            .rsplit('\n')
                            .next()
                            .unwrap_or("")
                            .chars()
                            .count()
                            + 1,
                    );
                }
                note.diagnostics.push(issue);
            }
        }
    }
    /// Fast startup snapshot. Full validation happens in index(), off the UI path.
    pub fn cached_index(&self) -> Result<LibraryIndex> {
        if let Ok(bytes) = fs::read(self.root.join(".cache/index.json"))
            && let Ok(mut index) = serde_json::from_slice::<LibraryIndex>(&bytes)
        {
            index
                .notes
                .retain(|note| valid_id(&note.id) && self.root.join(&note.id).is_dir());
            return Ok(index);
        }
        let mut notes = vec![];
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let id = entry.file_name().to_string_lossy().into_owned();
            if !valid_id(&id) || !entry.file_type()?.is_dir() {
                continue;
            }
            let Ok((path, metadata)) = self.paths(&id) else {
                continue;
            };
            let Ok(source) = fs::read_to_string(path) else {
                continue;
            };
            let title = metadata
                .fields
                .get("title")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| {
                    if metadata.kind == "literature" {
                        return literature::parse(&source, &id)
                            .ok()
                            .and_then(|entry| literature::field(&entry, "title"));
                    }
                    source
                        .lines()
                        .find_map(|line| line.strip_prefix("= ").map(str::to_owned))
                })
                .unwrap_or_else(|| id.clone());
            let revision = digest(
                [source.as_bytes(), &serde_json::to_vec(&metadata)?]
                    .concat()
                    .as_slice(),
            );
            notes.push(Note {
                id,
                title: title.clone(),
                title_text: title,
                title_html: None,
                tags: strings(metadata.fields.get("tags")),
                metadata,
                revision,
                links: vec![],
                diagnostic: None,
                diagnostics: vec![],
            });
        }
        notes.sort_by(|a, b| a.title_text.cmp(&b.title_text));
        Ok(LibraryIndex {
            notes,
            warnings: vec![],
            diagnostics: vec![],
        })
    }
    pub fn index(&self) -> Result<LibraryIndex> {
        // One library walk per pass, used only to retry unchanged failed compilations.
        let fingerprint = self.fingerprint()?;
        let compiler = compiler_key();
        let mut notes = vec![];
        let mut warnings = vec![];
        let mut diagnostics = vec![];
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let id = entry.file_name().to_string_lossy().into_owned();
            if !valid_id(&id) || !entry.file_type()?.is_dir() {
                continue;
            }
            match self.read_with_context(&id, Some(&fingerprint), Some(&compiler)) {
                Ok(doc) => notes.push(doc.note),
                Err(e) => {
                    warnings.push(format!("{id}: {e:#}"));
                    diagnostics.push(Diagnostic::new(
                        Severity::Error,
                        "invalid-note",
                        &id,
                        Some("meta.json"),
                        format!("{e:#}"),
                    ));
                }
            }
        }
        notes.sort_by(|a, b| {
            a.title_text
                .to_lowercase()
                .cmp(&b.title_text.to_lowercase())
                .then(a.id.cmp(&b.id))
        });
        diagnostics.extend(notes.iter().flat_map(|note| note.diagnostics.clone()));
        let result = LibraryIndex {
            notes,
            warnings,
            diagnostics,
        };
        let cache = self.root.join(".cache");
        fs::create_dir_all(&cache)?;
        atomic_write(
            &cache.join("index.json"),
            &serde_json::to_vec_pretty(&result)?,
        )?;
        Ok(result)
    }
    pub fn create(&self, title: &str, tags: Vec<String>) -> Result<NoteDocument> {
        ensure!(!title.trim().is_empty(), "Title must not be empty");
        self.create_inner(Some(title.trim()), tags, "typst", None, None)
    }

    /// Create an editable draft whose title comes from its heading.
    pub fn create_untitled(&self) -> Result<NoteDocument> {
        self.create_inner(None, vec![], "typst", None, None)
    }

    /// Daily notes are ordinary Typst notes whose IDs are their local dates.
    pub fn open_daily_note(&self) -> Result<NoteDocument> {
        let today = jiff::Zoned::now().date().to_string();
        self.create_inner(None, vec![], "typst", None, Some(&today))
    }

    pub fn create_literature(&self) -> Result<NoteDocument> {
        self.create_inner(None, vec![], "literature", None, None)
    }

    /// Metadata failures create no item. PDF failures preserve the imported
    /// reference and return a warning, so callers can offer a retry.
    pub fn import_publication(&self, input: &str) -> Result<PublicationImport> {
        let bibtex = publication::lookup(input)?;
        let entry = literature::parse(&bibtex, "IMPORT")?;
        let pdf = publication_pdf::PdfSource::from_entry(&entry);
        let mut document = self.create_inner(None, vec![], "literature", Some(&bibtex), None)?;
        let mut warnings = vec![];
        if let Some(pdf) = pdf {
            match self.attach_paper_pdf(&document.note.id, &pdf) {
                Ok(attachment) => document.attachments.push(attachment),
                Err(error) => warnings.push(format!("Publication imported, but its PDF could not be attached: {error:#}. Use Find and attach paper PDF to retry.")),
            }
        }
        Ok(PublicationImport { document, warnings })
    }

    fn create_inner(
        &self,
        title: Option<&str>,
        tags: Vec<String>,
        kind: &str,
        initial_bibtex: Option<&str>,
        daily_id: Option<&str>,
    ) -> Result<NoteDocument> {
        if let Some(id) = daily_id {
            ensure!(id.len() == 10 && valid_id(id), "Invalid daily note ID: {id}");
        }
        let heading = title.or(daily_id).unwrap_or("Untitled");
        const ALPHABET: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        let mut rng = rand::rng();
        for _ in 0..100 {
            let id = daily_id.map(str::to_owned).unwrap_or_else(|| {
                (0..5)
                    .map(|_| ALPHABET[rng.random_range(0..36)] as char)
                    .collect::<String>()
            });
            let dir = self.root.join(&id);
            match fs::create_dir(&dir) {
                Ok(()) => {
                    let result = (|| -> Result<NoteDocument> {
                        let mut fields = Map::new();
                        let today = daily_id
                            .map(str::to_owned)
                            .unwrap_or_else(|| jiff::Zoned::now().date().to_string());
                        if let Some(title) = title {
                            fields.insert("title".into(), json!(title));
                            fields.insert("tags".into(), json!(tags));
                        }
                        let metadata = Metadata {
                            kind: kind.into(),
                            document: if kind == "literature" {
                                "reference.bib"
                            } else {
                                "note.typ"
                            }
                            .into(),
                            fields,
                        };
                        atomic_write(
                            &dir.join("meta.json"),
                            &serde_json::to_vec_pretty(&metadata)?,
                        )?;
                        let source = if let Some(bibtex) = initial_bibtex {
                            literature::with_key(bibtex, &id)?
                        } else if kind == "literature" {
                            format!(
                                "@article{{{id},\n  title = {{Untitled}},\n  author = {{Author}},\n}}\n"
                            )
                        } else {
                            format!("#metadata(\"{today}\") <dox-date>\n\n= {heading}\n\n")
                        };
                        atomic_write(&dir.join(&metadata.document), source.as_bytes())?;
                        if initial_bibtex.is_some() {
                            return self.read(&id);
                        }
                        let revision = digest(
                            [source.as_bytes(), &serde_json::to_vec(&metadata)?]
                                .concat()
                                .as_slice(),
                        );
                        let mut merged_metadata = metadata;
                        if kind == "typst" {
                            merged_metadata.fields.insert("date".into(), json!(today));
                        }
                        Ok(NoteDocument {
                            attachments: vec![],
                            note: Note {
                                id: id.clone(),
                                metadata: merged_metadata,
                                title: heading.to_owned(),
                                title_html: None,
                                title_text: heading.to_owned(),
                                tags: tags.clone(),
                                links: vec![],
                                revision,
                                diagnostic: None,
                                diagnostics: vec![],
                            },
                            source,
                        })
                    })();
                    if result.is_err() {
                        let _ = fs::remove_dir_all(&dir);
                    }
                    return result;
                }
                // A date identifies one note, independent of its current title.
                // Read an existing item without overwriting any of its files.
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists && daily_id.is_some() => {
                    return self.read(&id);
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.into()),
            }
        }
        bail!("Unable to allocate a unique note ID")
    }
    pub fn save(&self, id: &str, source: &str, expected_revision: &str) -> Result<NoteDocument> {
        let current = self.read(id)?;
        ensure!(
            current.note.revision == expected_revision,
            "Conflict: this note changed on disk. Reload it before saving; your draft has not been written."
        );
        let (path, metadata) = self.paths(id)?;
        if metadata.kind == "literature" {
            literature::parse(source, id)?;
        }
        atomic_write(&path, source.as_bytes())?;
        self.read(id)
    }
    /// Set a Typst note's source date, retaining revision conflict protection.
    pub fn set_date(&self, id: &str, date: &str, expected_revision: &str) -> Result<NoteDocument> {
        ensure!(
            valid_date(date),
            "Date must be YYYY, YYYY-MM, or YYYY-MM-DD"
        );
        let document = self.read(id)?;
        ensure!(
            document.note.metadata.kind == "typst",
            "Edit the date in the BibTeX source for literature items"
        );
        let command = format!("#metadata(\"{date}\") <dox-date>");
        let pattern = Regex::new(r#"#metadata\(\s*"[^"\r\n]*"\s*\)\s*<dox-date>"#)?;
        let source = if pattern.is_match(&document.source) {
            pattern
                .replace_all(&document.source, regex::NoExpand(&command))
                .into_owned()
        } else {
            format!("{}\n{command}\n", document.source)
        };
        self.save(id, &source, expected_revision)
    }

    pub fn delete(&self, id: &str, expected_revision: &str) -> Result<DeletedNote> {
        let current = self.read(id)?;
        ensure!(
            current.note.revision == expected_revision,
            "Conflict: this note changed on disk. Reload it before deleting."
        );
        Self::init(&self.root)?;
        let source = self.root.join(id);
        ensure!(
            fs::symlink_metadata(&source)?.file_type().is_dir(),
            "Cannot delete a symlinked note directory"
        );
        let trash = self.root.join(".trash");
        fs::create_dir_all(&trash)?;
        ensure!(
            fs::symlink_metadata(&trash)?.file_type().is_dir(),
            "Trash must be a real directory"
        );
        let entry = format!(
            "{id}-{}-{:08X}",
            jiff::Timestamp::now().as_millisecond(),
            rand::random::<u32>()
        );
        fs::rename(&source, trash.join(&entry))?;
        Ok(DeletedNote {
            id: id.into(),
            trash_entry: entry,
        })
    }

    pub fn restore(&self, trash_entry: &str) -> Result<NoteDocument> {
        ensure!(
            Path::new(trash_entry).components().count() == 1
                && Path::new(trash_entry)
                    .components()
                    .all(|c| matches!(c, Component::Normal(_))),
            "Invalid trash entry"
        );
        // Remove the timestamp and random suffix from the right: date IDs contain hyphens.
        let id = trash_entry
            .rsplitn(3, '-')
            .nth(2)
            .context("Invalid trash entry")?;
        ensure!(valid_id(id), "Invalid note ID in trash entry");
        let trash = self.root.join(".trash");
        ensure!(
            fs::symlink_metadata(&trash)?.file_type().is_dir(),
            "Trash must be a real directory"
        );
        let source = trash.join(trash_entry);
        ensure!(
            fs::symlink_metadata(&source)?.file_type().is_dir(),
            "Trash entry must be a real directory"
        );
        let destination = self.root.join(id);
        ensure!(
            fs::symlink_metadata(&destination)
                .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound),
            "A note with ID {id} already exists"
        );
        fs::rename(source, destination)?;
        self.read(id)
    }

    fn compile_document(
        &self,
        path: &Path,
        id: &str,
        diagnostics: &mut Vec<Diagnostic>,
    ) -> Result<compiler::CompiledDocument> {
        let prepared = self.citation_document(path)?;
        self.compiler.compile(&prepared, None, id, diagnostics)
    }

    fn compile_html(
        &self,
        path: &Path,
        id: &str,
        diagnostics: &mut Vec<Diagnostic>,
    ) -> Result<String> {
        Ok(self.compile_document(path, id, diagnostics)?.html)
    }

    fn compile_title(
        &self,
        markup: &str,
        id: &str,
        diagnostics: &mut Vec<Diagnostic>,
        dependencies: &mut Option<Vec<FileStamp>>,
    ) -> Result<(String, String)> {
        let source = format!(
            "{SVG_MATH}\n#html.elem(\"span\", attrs: (\"data-dox-title\": \"\"))[{markup}]\n"
        );
        let mut title_diagnostics = vec![];
        let result = self.compiler.compile(
            &self.root.join(".cache").join(id).join("title.typ"),
            Some(&source),
            id,
            &mut title_diagnostics,
        );
        for diagnostic in &mut title_diagnostics {
            diagnostic.code = if diagnostic.severity == Severity::Error {
                "typst-title".into()
            } else {
                "typst-title-warning".into()
            };
            diagnostic.document = Some("meta.json".into());
            diagnostic.line = None;
            diagnostic.column = None;
        }
        diagnostics.extend(title_diagnostics);
        let output = result?;
        *dependencies = output.dependencies;
        let html = output.html;
        let document = HtmlDocument::from(html.as_str());
        let title = document.select_single("[data-dox-title]");
        ensure!(title.exists(), "Compiled title is missing");
        Ok((
            title.inner_html().to_string(),
            if title.select("svg").exists() {
                markup.to_owned()
            } else {
                title.text().to_string()
            },
        ))
    }

    pub fn render(&self, id: &str) -> Result<String> {
        let document = self.read(id)?;
        let note = document.note;
        if note.metadata.kind == "literature" {
            return literature::render(&document.source, id, &note.title_text);
        }
        ensure!(
            note.metadata.kind == "typst",
            "Viewing note type '{}' is not supported yet",
            note.metadata.kind
        );
        if let Some(error) = note.diagnostic {
            bail!("{error}");
        }
        let cache = self.root.join(".cache").join(id).join("note.html");
        if let Ok(html) = fs::read_to_string(&cache) {
            return Ok(html);
        }
        let (path, _) = self.paths(id)?;
        let html = self.compile_html(&path, id, &mut vec![])?;
        atomic_write(&cache, html.as_bytes())?;
        Ok(html)
    }
    pub fn watch(
        &self,
        on_change: impl Fn() + Send + Sync + 'static,
    ) -> Result<Box<dyn Watcher + Send>> {
        let root = self.root.clone();
        let on_change = Arc::new(on_change);
        let handler = move |result: notify::Result<notify::Event>| {
            if let Ok(event) = result {
                if matches!(event.kind, notify::EventKind::Access(_)) {
                    return;
                }
                if event.paths.iter().any(|p| {
                    p.strip_prefix(&root).is_ok_and(|r| {
                        !r.starts_with(".cache")
                            && !r.starts_with(".git")
                            && !r.starts_with(".trash")
                    })
                }) {
                    on_change();
                }
            }
        };
        if let Ok(mut watcher) = notify::recommended_watcher(handler.clone())
            && watcher.watch(&self.root, RecursiveMode::Recursive).is_ok()
        {
            return Ok(Box::new(watcher));
        }
        let config = notify::Config::default()
            .with_poll_interval(std::time::Duration::from_secs(1))
            .with_compare_contents(true);
        let mut watcher = notify::PollWatcher::new(handler, config)?;
        watcher.watch(&self.root, RecursiveMode::Recursive)?;
        Ok(Box::new(watcher))
    }
}
