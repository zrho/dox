use anyhow::Result;
use clap::{Parser, Subcommand};
use dox_core::Library;
use std::{io::Read, path::PathBuf};

#[derive(Parser)]
#[command(version, about = "Local, linked Typst notes")]
struct Args {
    #[arg(short, long, global = true, default_value = ".")]
    library: PathBuf,
    #[command(subcommand)]
    command: Action,
}
#[derive(Subcommand)]
enum Action {
    /// Initialize a library and its cache ignore rule.
    Init,
    /// Create a Typst note.
    New {
        title: String,
        #[arg(long)]
        tags: Vec<String>,
    },
    /// Create an editable single-entry BibTeX literature item.
    Literature,
    /// Import publication metadata, including the PDF for arXiv items.
    ImportPublication { input: String },
    /// Find and attach a paper PDF using a literature item's saved BibTeX.
    FindPaperPdf { id: String },
    /// List files attached to any item.
    Attachments { id: String },
    /// Copy a file into an item's attachments directory.
    Attach { id: String, path: PathBuf },
    /// Remove an attached copy from the library.
    RemoveAttachment { id: String, name: String },
    /// List notes and rebuild cached metadata.
    List {
        #[arg(long)]
        tag: Option<String>,
        #[arg(long)]
        search: Option<String>,
    },
    /// Read a note and its revision as JSON.
    Show { id: String },
    /// Write source from stdin, refusing to overwrite a different revision.
    Save {
        id: String,
        #[arg(long)]
        revision: String,
    },
    /// Set a Typst note's source date (YYYY, YYYY-MM, or YYYY-MM-DD).
    Date {
        id: String,
        date: String,
        #[arg(long)]
        revision: String,
    },
    /// Move a note into library-local trash. Prints the restore token.
    Delete {
        id: String,
        #[arg(long)]
        revision: String,
    },
    /// Restore a note using the trash_entry token returned by delete.
    Restore { trash_entry: String },
    /// List structured errors, warnings, and proposals, optionally for one note.
    Diagnostics {
        #[arg(long)]
        id: Option<String>,
    },
    /// Compile a note to HTML on stdout.
    Render { id: String },
    /// List notes linking to a given ID.
    Backlinks { id: String },
    /// Write web/docker-compose.yml; rendering happens during deployment.
    PrepareWeb,
    /// Export a portable read-only website from saved library content.
    ExportWeb {
        output: PathBuf,
        #[arg(long)]
        replace: bool,
    },
    /// Print change notifications until interrupted.
    Watch,
}
fn main() -> Result<()> {
    let args = Args::parse();
    if matches!(args.command, Action::Init) {
        let lib = Library::init(args.library)?;
        println!("{}", lib.root().display());
        return Ok(());
    }
    let lib = Library::open(args.library)?;
    let result = match args.command {
        Action::Init => unreachable!(),
        Action::New { title, tags } => serde_json::to_value(lib.create(&title, tags)?)?,
        Action::Literature => serde_json::to_value(lib.create_literature()?)?,
        Action::ImportPublication { input } => {
            serde_json::to_value(lib.import_publication(&input)?)?
        }
        Action::FindPaperPdf { id } => serde_json::to_value(lib.find_paper_pdf(&id, None)?)?,
        Action::Attachments { id } => serde_json::to_value(lib.attachments(&id)?)?,
        Action::Attach { id, path } => serde_json::to_value(lib.attach_file(&id, path)?)?,
        Action::RemoveAttachment { id, name } => {
            lib.remove_attachment(&id, &name)?;
            serde_json::Value::Null
        }
        Action::List { tag, search } => {
            let mut index = lib.index()?;
            index.notes.retain(|n| {
                tag.as_ref().is_none_or(|t| n.tags.contains(t))
                    && search.as_ref().is_none_or(|s| {
                        format!("{} {} {} {}", n.id, n.title, n.title_text, n.tags.join(" "))
                            .to_lowercase()
                            .contains(&s.to_lowercase())
                    })
            });
            serde_json::to_value(index)?
        }
        Action::Show { id } => serde_json::to_value(lib.read(&id)?)?,
        Action::Save { id, revision } => {
            let mut source = String::new();
            std::io::stdin().read_to_string(&mut source)?;
            serde_json::to_value(lib.save(&id, &source, &revision)?)?
        }
        Action::Date { id, date, revision } => {
            serde_json::to_value(lib.set_date(&id, &date, &revision)?)?
        }
        Action::Delete { id, revision } => serde_json::to_value(lib.delete(&id, &revision)?)?,
        Action::Restore { trash_entry } => serde_json::to_value(lib.restore(&trash_entry)?)?,
        Action::Diagnostics { id } => serde_json::to_value(
            lib.index()?
                .diagnostics
                .into_iter()
                .filter(|d| id.as_ref().is_none_or(|id| d.note_id.as_ref() == Some(id)))
                .collect::<Vec<_>>(),
        )?,
        Action::Render { id } => {
            print!("{}", lib.render(&id)?);
            return Ok(());
        }
        Action::Backlinks { id } => serde_json::to_value(
            lib.index()?
                .notes
                .into_iter()
                .filter(|n| n.links.contains(&id))
                .collect::<Vec<_>>(),
        )?,
        Action::PrepareWeb => serde_json::to_value(lib.prepare_web_deployment()?)?,
        Action::ExportWeb { output, replace } => serde_json::to_value(lib.export_web(
            dox_core::ExportOptions {
                destination: output,
                replace,
            },
            |progress| {
                eprintln!(
                    "{} ({}/{})",
                    progress.message, progress.completed, progress.total
                )
            },
        )?)?,
        Action::Watch => {
            let (tx, rx) = std::sync::mpsc::channel();
            let _watcher = lib.watch(move || {
                let _ = tx.send(());
            })?;
            for () in rx {
                println!("{{\"event\":\"library-changed\"}}");
            }
            return Ok(());
        }
    };
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
