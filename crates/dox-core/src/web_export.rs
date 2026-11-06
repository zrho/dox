//! A portable, source-free reading snapshot. No hosting provider integration.
use crate::{Library, Severity};
use anyhow::{Context, Result, bail, ensure};
use dom_query::Document;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

include!(concat!(env!("OUT_DIR"), "/web_assets.rs"));
const SCHEMA: u32 = 1;
const MARKER: &str = ".dox-export.json";

pub struct ExportOptions {
    pub destination: PathBuf,
    pub replace: bool,
}
#[derive(Clone, Serialize)]
pub struct ExportProgress {
    pub completed: usize,
    pub total: usize,
    pub message: String,
}
#[derive(Serialize)]
pub struct ExportReport {
    pub destination: PathBuf,
    pub notes: usize,
    pub attachments: usize,
    pub warnings: Vec<String>,
}
#[derive(Serialize, Deserialize)]
struct ExportMarker {
    schema_version: u32,
    snapshot: String,
}
#[derive(Serialize)]
struct ReaderNote {
    id: String,
    title: String,
    title_html: Option<String>,
    kind: String,
    date: Option<String>,
    tags: Vec<String>,
    links: Vec<String>,
    html: String,
    attachments: Vec<ReaderAttachment>,
}
#[derive(Serialize)]
struct ReaderAttachment {
    name: String,
    size: u64,
    url: String,
    hash: String,
}
#[derive(Serialize)]
struct ReaderIndex<'a> {
    schema_version: u32,
    title: &'a str,
    created_at: &'a str,
    notes: Vec<ReaderEntry<'a>>,
}
#[derive(Serialize)]
struct ReaderEntry<'a> {
    id: &'a str,
    title: &'a str,
    kind: &'a str,
    title_html: &'a Option<String>,
    tags: &'a [String],
    links: &'a [String],
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn write_file(root: &Path, relative: &str, bytes: &[u8]) -> Result<()> {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap())?;
    fs::write(path, bytes)?;
    Ok(())
}
fn marker(path: &Path) -> Result<Vec<u8>> {
    ensure!(
        fs::symlink_metadata(path)?.is_dir(),
        "Output must be a regular directory"
    );
    let bytes = fs::read(path.join(MARKER))
        .context("Refusing to replace a directory that is not a dox website export")?;
    let value: ExportMarker =
        serde_json::from_slice(&bytes).context("Invalid dox export marker")?;
    ensure!(
        value.schema_version == SCHEMA,
        "Unsupported dox export version"
    );
    Ok(bytes)
}
// Typst embeds ordinary images. Raw HTML show rules may still reference local
// images; package those explicitly instead of leaking filesystem dependencies.
fn package_html(
    library: &Library,
    id: &str,
    html: &str,
    files: &mut BTreeMap<String, Vec<u8>>,
) -> Result<String> {
    let document = Document::from(html);
    let css_resources = regex::Regex::new(r"(?i)url\s*\(|@import|image-set\s*\(")?;
    for node in document.select("style").nodes() {
        ensure!(
            !css_resources.is_match(&node.text()),
            "{id}: CSS resource dependencies cannot be exported; use Typst images instead"
        );
    }
    for node in document.select("[style]").nodes() {
        ensure!(
            !css_resources.is_match(&node.attr("style").unwrap_or_default()),
            "{id}: CSS resource dependencies cannot be exported; use Typst images instead"
        );
    }
    for node in document.select("svg use").nodes() {
        for attr in ["href", "xlink:href"] {
            if let Some(reference) = node.attr(attr) {
                ensure!(
                    reference.starts_with('#'),
                    "{id}: external SVG glyph references cannot be exported"
                );
            }
        }
    }
    for node in document.select("[src], [srcset], svg image").nodes() {
        ensure!(
            node.attr("srcset").is_none(),
            "{id}: responsive image sources are not supported in website exports"
        );
        for attribute in ["src", "href", "xlink:href"] {
            let Some(value) = node.attr(attribute) else {
                continue;
            };
            let value = value.to_string();
            if value.starts_with("data:") || value.starts_with('#') {
                continue;
            }
            ensure!(
                !value.contains(':') && !value.starts_with('/') && !value.starts_with("//"),
                "{id}: image resources must be embedded or library-local"
            );
            let decoded = percent_encoding::percent_decode_str(&value).decode_utf8()?;
            let source = library
                .note_dir(id)?
                .join(decoded.as_ref())
                .canonicalize()
                .with_context(|| format!("{id}: unresolved image resource"))?;
            ensure!(
                source.starts_with(library.root()),
                "{id}: image resource is outside the library"
            );
            let bytes = fs::read(&source)?;
            let extension = source
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            ensure!(
                ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"].contains(&extension.as_str()),
                "{id}: unsupported image resource"
            );
            let relative = format!("media/{}.{}", hash(&bytes), extension);
            node.set_attr(attribute, &format!("./{relative}"));
            files.insert(relative, bytes);
        }
    }
    // External stylesheets/fonts are not part of the supported note renderer.
    ensure!(
        !document.select("link[rel=stylesheet]").exists(),
        "{id}: external stylesheets cannot be exported"
    );
    Ok(document.html().to_string())
}

impl Library {
    pub fn export_web(
        &self,
        options: ExportOptions,
        mut progress: impl FnMut(ExportProgress),
    ) -> Result<ExportReport> {
        let name = options
            .destination
            .file_name()
            .context("Choose an output directory name")?;
        let parent = options
            .destination
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."))
            .canonicalize()
            .context("The output parent directory must already exist")?;
        let destination = parent.join(name);
        let root = self.root().canonicalize()?;
        ensure!(
            !destination.starts_with(&root) && !root.starts_with(&destination),
            "The export destination must not overlap the library"
        );
        let previous = if destination.try_exists()? {
            ensure!(
                options.replace,
                "Output already exists; use --replace to replace a dox website export"
            );
            Some(marker(&destination)?)
        } else {
            None
        };
        let stage = tempfile::Builder::new()
            .prefix(".dox-export-")
            .tempdir_in(&parent)?;
        let initial_fingerprint = self.fingerprint()?;
        progress(ExportProgress {
            completed: 0,
            total: 0,
            message: "Compiling saved library content…".into(),
        });
        let index = self.index()?;
        let failures: Vec<_> = index
            .diagnostics
            .iter()
            .filter(|d| {
                matches!(d.severity, Severity::Error) && !matches!(d.code.as_str(), "dangling-link")
            })
            .collect();
        if !failures.is_empty() {
            bail!(
                "Cannot export library:\n{}",
                failures
                    .iter()
                    .map(|d| format!(
                        "{}: {}",
                        d.note_id.as_deref().unwrap_or("Library"),
                        d.message
                    ))
                    .collect::<Vec<_>>()
                    .join("\n")
            );
        }
        let created_at = jiff::Timestamp::now().to_string();
        let title = root
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Notes")
            .to_owned();
        let mut files = BTreeMap::new();
        let mut notes = vec![];
        let mut attachment_count = 0;
        let mut attachment_urls = BTreeSet::new();
        let mut attachment_stamps = vec![];
        for (position, note) in index.notes.iter().enumerate() {
            let document = self.read(&note.id)?;
            ensure!(
                document.note.revision == note.revision,
                "Library changed during export; retry"
            );
            let html = package_html(self, &note.id, &self.render(&note.id)?, &mut files)?;
            let title_html = note
                .title_html
                .as_ref()
                .map(|html| package_html(self, &note.id, html, &mut files))
                .transpose()?;
            let mut attachments = vec![];
            for attachment in self.attachments(&note.id)? {
                let path = self.attachment_path(&note.id, &attachment.name)?;
                let bytes = fs::read(&path)?;
                let digest = hash(&bytes);
                attachment_stamps.push((path, digest.clone()));
                let extension = Path::new(&attachment.name)
                    .extension()
                    .and_then(|s| s.to_str())
                    .filter(|s| s.len() <= 12 && s.chars().all(|c| c.is_ascii_alphanumeric()))
                    .unwrap_or("bin")
                    .to_ascii_lowercase();
                let relative = format!("attachments/{digest}.{extension}");
                attachments.push(ReaderAttachment {
                    name: attachment.name,
                    size: bytes.len() as u64,
                    url: format!("./{relative}"),
                    hash: digest,
                });
                write_file(stage.path(), &relative, &bytes)?;
                attachment_urls.insert(relative);
                attachment_count += 1;
            }
            notes.push(ReaderNote {
                id: note.id.clone(),
                title: note.title_text.clone(),
                title_html,
                kind: note.metadata.kind.clone(),
                date: note
                    .metadata
                    .fields
                    .get("date")
                    .and_then(|v| v.as_str())
                    .map(str::to_owned),
                tags: note.tags.clone(),
                links: note.links.clone(),
                html,
                attachments,
            });
            progress(ExportProgress {
                completed: position + 1,
                total: index.notes.len(),
                message: format!("Rendered {}", note.id),
            });
        }
        let library_index = ReaderIndex {
            schema_version: SCHEMA,
            title: &title,
            created_at: &created_at,
            notes: notes
                .iter()
                .map(|n| ReaderEntry {
                    id: &n.id,
                    title: &n.title,
                    kind: &n.kind,
                    title_html: &n.title_html,
                    tags: &n.tags,
                    links: &n.links,
                })
                .collect(),
        };
        let index_bytes = serde_json::to_vec(&library_index)?;
        let mut identity = Sha256::new();
        identity.update(&index_bytes);
        for note in &notes {
            identity.update(serde_json::to_vec(note)?);
        }
        for (name, bytes) in WEB_ASSETS {
            identity.update(name.as_bytes());
            identity.update(bytes);
        }
        let snapshot = format!("{:x}", identity.finalize());
        let prefix = format!("snapshots/{snapshot}");
        files.insert(format!("{prefix}/library.json"), index_bytes);
        for note in &notes {
            files.insert(
                format!("{prefix}/notes/{}.json", note.id),
                serde_json::to_vec(note)?,
            );
        }
        for (name, bytes) in WEB_ASSETS {
            files.insert((*name).into(), bytes.to_vec());
        }
        let snapshot_data = serde_json::json!({ "schema_version": SCHEMA, "snapshot": snapshot, "title": title, "created_at": created_at, "library_url": format!("./{prefix}/library.json") });
        files.insert("snapshot.json".into(), serde_json::to_vec(&snapshot_data)?);
        let resources: Vec<_> = files
            .iter()
            .filter(|(name, _)| !name.starts_with("attachments/"))
            .map(|(url, bytes)| serde_json::json!({ "url": url, "hash": hash(bytes) }))
            .collect();
        let worker = include_str!("../../../web-reader/worker.js").replace(
            "/* EXPORT_CONFIGURATION */",
            &format!(
                "const SNAPSHOT = {};\nconst RESOURCES = {};\nconst ATTACHMENTS = {};",
                serde_json::to_string(&snapshot)?,
                serde_json::to_string(&resources)?,
                serde_json::to_string(&attachment_urls)?
            ),
        );
        files.insert("sw.js".into(), worker.into_bytes());
        files.insert(".nojekyll".into(), vec![]);
        files.insert(
            MARKER.into(),
            serde_json::to_vec(&ExportMarker {
                schema_version: SCHEMA,
                snapshot,
            })?,
        );
        for (name, bytes) in &files {
            write_file(stage.path(), name, bytes)?;
        }
        ensure!(
            self.fingerprint()? == initial_fingerprint,
            "Library changed during export; retry"
        );
        for (path, digest) in attachment_stamps {
            ensure!(
                hash(&fs::read(path)?) == digest,
                "An attachment changed during export; retry"
            );
        }
        if let Some(previous) = previous {
            ensure!(
                marker(&destination)? == previous,
                "Output changed during export; retry"
            );
            let backup = tempfile::Builder::new()
                .prefix(".dox-export-backup-")
                .tempdir_in(&parent)?;
            let old = backup.path().join("previous");
            fs::rename(&destination, &old)?;
            if let Err(error) = fs::rename(stage.path(), &destination) {
                if let Err(restore_error) = fs::rename(&old, &destination) {
                    let retained = backup.keep();
                    bail!(
                        "Export failed: {error}. Could not restore previous export: {restore_error}. Previous export retained at {}",
                        retained.join("previous").display()
                    );
                }
                return Err(error.into());
            }
        } else {
            ensure!(
                !destination.try_exists()?,
                "Output appeared during export; choose another destination"
            );
            fs::rename(stage.path(), &destination)?;
        }
        Ok(ExportReport {
            destination,
            notes: notes.len(),
            attachments: attachment_count,
            warnings: notes
                .iter()
                .flat_map(|note| {
                    note.links
                        .iter()
                        .filter(|id| !notes.iter().any(|n| &n.id == *id))
                        .map(|id| format!("{} links to missing item {id}", note.id))
                })
                .collect(),
        })
    }
}
