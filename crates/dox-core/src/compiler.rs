//! Embedded Typst HTML compilation, with a fresh file snapshot per request.
use crate::{Diagnostic, FileStamp, Severity};
use anyhow::{Context, Result, anyhow};
use std::{
    borrow::Cow,
    collections::HashMap,
    fmt, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use typst::{
    World, WorldExt,
    diag::{FileError, FileResult, SourceDiagnostic},
    foundations::{Bytes, NativeElement, Selector},
    introspection::{Introspector, MetadataElem},
    model::CiteElem,
    syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot},
};
use typst_as_lib::{
    TypstEngine,
    file_resolver::FileResolver,
    package_resolver::{FileSystemCache, PackageResolver},
    typst_kit_options::TypstKitFontOptions,
};
use typst_html::HtmlDocument;

pub(crate) const VERSION: &str = "typst-as-lib-0.17.0/typst-0.15.1/html-v1";

pub(crate) struct CompiledDocument {
    pub html: String,
    pub metadata: Vec<serde_json::Value>,
    pub citations: Vec<serde_json::Value>,
    pub dependencies: Option<Vec<FileStamp>>,
}

pub(crate) struct Compiler {
    root: PathBuf,
    // Serializing access gives each compilation a consistent snapshot while
    // retaining the engine's font discovery and lazy font slots across notes.
    engine: Mutex<Option<TypstEngine>>,
    files: Arc<Mutex<Files>>,
}
impl fmt::Debug for Compiler {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Compiler")
            .field("root", &self.root)
            .finish_non_exhaustive()
    }
}

impl Compiler {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            engine: Mutex::new(None),
            files: Arc::new(Mutex::new(Files::default())),
        }
    }

    pub fn compile(
        &self,
        path: &Path,
        source: Option<&str>,
        note_id: &str,
        diagnostics: &mut Vec<Diagnostic>,
    ) -> Result<CompiledDocument> {
        let relative = path
            .strip_prefix(&self.root)
            .context("Typst document is outside the library")?;
        let id = FileId::new(RootedPath::new(
            VirtualRoot::Project,
            VirtualPath::new(
                relative
                    .to_str()
                    .context("Typst paths must be valid UTF-8")?,
            )?,
        ));
        let mut engine = self
            .engine
            .lock()
            .map_err(|_| anyhow!("Typst compiler unavailable"))?;
        if engine.is_none() {
            *engine = Some(self.build_engine()?);
        }
        {
            let mut files = self
                .files
                .lock()
                .map_err(|_| anyhow!("Typst files unavailable"))?;
            *files = Files::default();
            if let Some(source) = source {
                files.sources.insert(id, Source::new(id, source.to_owned()));
                files
                    .bytes
                    .insert(id, Bytes::new(source.as_bytes().to_vec()));
            }
        }
        engine
            .as_ref()
            .unwrap()
            .with_world(id, |world| {
                let compiled = typst::compile::<HtmlDocument>(world);
                diagnostics.extend(self.diagnostics(world, &compiled.warnings, note_id, path));
                let document = compiled.output.map_err(|errors| {
                    let errors = self.diagnostics(world, &errors, note_id, path);
                    let message = errors
                        .iter()
                        .map(|issue| issue.message.as_str())
                        .collect::<Vec<_>>()
                        .join("\n");
                    diagnostics.extend(errors);
                    anyhow!(message)
                })?;
                let html = typst_html::html(&document, &Default::default()).map_err(|errors| {
                    let errors = self.diagnostics(world, &errors, note_id, path);
                    let message = errors
                        .iter()
                        .map(|issue| issue.message.as_str())
                        .collect::<Vec<_>>()
                        .join("\n");
                    diagnostics.extend(errors);
                    anyhow!(message)
                })?;
                let query = |selector| -> Result<Vec<serde_json::Value>> {
                    document
                        .introspector()
                        .query(&selector)
                        .iter()
                        .map(|content| serde_json::to_value(content).map_err(Into::into))
                        .collect()
                };
                let metadata = query(Selector::Elem(MetadataElem::ELEM, None))?;
                let citations = query(Selector::Elem(CiteElem::ELEM, None))?;
                let files = self
                    .files
                    .lock()
                    .map_err(|_| anyhow!("Typst files unavailable"))?;
                let dependencies = (!files.missing
                    && files.dependencies.values().all(FileStamp::unchanged))
                .then(|| files.dependencies.values().cloned().collect());
                Ok(CompiledDocument {
                    html,
                    metadata,
                    citations,
                    dependencies,
                })
            })
            .map_err(|error| anyhow!(error.to_string()))?
    }

    fn build_engine(&self) -> Result<TypstEngine> {
        let cache = std::env::var_os("TYPST_PACKAGE_CACHE_PATH")
            .map(PathBuf::from)
            .or_else(|| dirs::cache_dir().map(|path| path.join("typst/packages")))
            .context("No Typst package cache directory is available")?;
        let local = std::env::var_os("TYPST_PACKAGE_PATH")
            .map(PathBuf::from)
            .or_else(|| dirs::data_dir().map(|path| path.join("typst/packages")));
        let client = reqwest::blocking::Client::builder()
            .tls_backend_native()
            .user_agent(concat!("dox/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .build()?;
        let packages = PackageResolver::builder()
            .cache(FileSystemCache(cache.clone()))
            .reqwest_client(client)
            .request_retry_count(2)
            .build();
        let fonts = TypstKitFontOptions::default()
            .include_embedded_fonts(true)
            .include_system_fonts(
                std::env::var("TYPST_IGNORE_SYSTEM_FONTS").as_deref() != Ok("true"),
            )
            .include_dirs(
                std::env::var_os("TYPST_FONT_PATHS")
                    .map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
                    .unwrap_or_default(),
            );
        Ok(TypstEngine::builder()
            .search_fonts_with(fonts)
            .add_file_resolver(Resolver {
                root: self.root.clone(),
                cache,
                local,
                packages,
                files: self.files.clone(),
            })
            .build())
    }

    fn diagnostics(
        &self,
        world: &dyn World,
        issues: &[SourceDiagnostic],
        note_id: &str,
        fallback: &Path,
    ) -> Vec<Diagnostic> {
        issues
            .iter()
            .filter_map(|issue| {
                let severity = match issue.severity {
                    typst::diag::Severity::Error => Severity::Error,
                    typst::diag::Severity::Warning => Severity::Warning,
                };
                if severity == Severity::Warning
                    && issue
                        .message
                        .contains("html export is under active development")
                {
                    return None;
                }
                let mut message = issue.message.to_string();
                for hint in &issue.hints {
                    message.push_str(&format!("\nhint: {}", hint.v));
                }
                for trace in &issue.trace {
                    message.push_str(&format!("\n{}", trace.v));
                }
                let location = issue.span.id().and_then(|id| {
                    let source = world.source(id).ok()?;
                    let range = world.range(issue.span)?;
                    let (line, column) = source.lines().byte_to_line_column(range.start)?;
                    let path = self.files.lock().ok()?.paths.get(&id)?.clone();
                    Some((path, line + 1, column + 1))
                });
                let document = location
                    .as_ref()
                    .map(|(path, _, _)| path.as_path())
                    .unwrap_or(fallback);
                let mut diagnostic = Diagnostic::new(
                    severity,
                    if severity == Severity::Error {
                        "typst-compile"
                    } else {
                        "typst-warning"
                    },
                    note_id,
                    Some(&document.to_string_lossy()),
                    message,
                );
                if let Some((_, line, column)) = location {
                    diagnostic.line = Some(line);
                    diagnostic.column = Some(column);
                    diagnostic.id =
                        crate::digest(format!("{}:{line}:{column}", diagnostic.id).as_bytes());
                }
                Some(diagnostic)
            })
            .collect()
    }
}

#[derive(Default)]
struct Files {
    sources: HashMap<FileId, Source>,
    bytes: HashMap<FileId, Bytes>,
    paths: HashMap<FileId, PathBuf>,
    dependencies: HashMap<PathBuf, FileStamp>,
    missing: bool,
}
struct Resolver {
    root: PathBuf,
    cache: PathBuf,
    local: Option<PathBuf>,
    packages: PackageResolver<FileSystemCache>,
    files: Arc<Mutex<Files>>,
}
impl Resolver {
    fn load(&self, id: FileId) -> FileResult<Bytes> {
        let mut files = self.files.lock().map_err(|_| FileError::Other(None))?;
        if let Some(bytes) = files.bytes.get(&id) {
            return Ok(bytes.clone());
        }
        let result = (|| {
            let base = match id.root() {
                VirtualRoot::Project => self.root.clone(),
                VirtualRoot::Package(package) => {
                    let package_dir = PathBuf::from(package.namespace.as_str())
                        .join(package.name.as_str())
                        .join(package.version.to_string());
                    let local = self.local.as_ref().map(|root| root.join(&package_dir));
                    if let Some(local) = local.filter(|path| path.is_dir()) {
                        local
                    } else {
                        // The package resolver handles cache lookup and downloads.
                        self.packages.resolve_binary(id)?;
                        self.cache.join(package_dir)
                    }
                }
            };
            let path = id
                .vpath()
                .realize(&base)
                .map_err(|_| FileError::AccessDenied)?;
            let path = path
                .canonicalize()
                .map_err(|error| FileError::from_io(error, &path))?;
            let base = base
                .canonicalize()
                .map_err(|error| FileError::from_io(error, &base))?;
            if !path.starts_with(&base) {
                return Err(FileError::AccessDenied);
            }
            let stamp = FileStamp::read(path.clone())
                .map_err(|error| FileError::Other(Some(error.to_string().into())))?;
            let bytes = fs::read(&path).map_err(|error| FileError::from_io(error, &path))?;
            files.paths.insert(id, path.clone());
            files.dependencies.insert(path, stamp);
            Ok(Bytes::new(bytes))
        })();
        match result {
            Ok(bytes) => {
                files.bytes.insert(id, bytes.clone());
                Ok(bytes)
            }
            Err(error) => {
                files.missing = true;
                Err(error)
            }
        }
    }
}
impl FileResolver for Resolver {
    fn resolve_binary(&self, id: FileId) -> FileResult<Cow<'_, Bytes>> {
        self.load(id).map(Cow::Owned)
    }
    fn resolve_source(&self, id: FileId) -> FileResult<Cow<'_, Source>> {
        if let Some(source) = self
            .files
            .lock()
            .map_err(|_| FileError::Other(None))?
            .sources
            .get(&id)
            .cloned()
        {
            return Ok(Cow::Owned(source));
        }
        let bytes = self.load(id)?;
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| FileError::InvalidUtf8)?
            .trim_start_matches('\u{feff}');
        let source = Source::new(id, text.to_owned());
        self.files
            .lock()
            .map_err(|_| FileError::Other(None))?
            .sources
            .insert(id, source.clone());
        Ok(Cow::Owned(source))
    }
}
