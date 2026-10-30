use crate::Library;
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Component, Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub name: String,
    pub size: u64,
}

const TEMP_PREFIX: &str = ".dox-attachment-";

fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains(['/', '\\'])
        && !name.starts_with(TEMP_PREFIX)
        && matches!(
            Path::new(name).components().collect::<Vec<_>>().as_slice(),
            [Component::Normal(_)]
        )
}

impl Library {
    fn attachment_directory(&self, id: &str) -> Result<PathBuf> {
        self.paths(id)?;
        let dir = self.note_dir(id)?.join("attachments");
        match fs::symlink_metadata(&dir) {
            Ok(metadata) => ensure!(
                metadata.is_dir(),
                "Attachments must be a directory, not a file or symlink"
            ),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        Ok(dir)
    }

    /// Attachments are ordinary files, independent of source and metadata revisions.
    pub fn attachments(&self, id: &str) -> Result<Vec<Attachment>> {
        let dir = self.attachment_directory(id)?;
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
            Err(error) => return Err(error.into()),
        };
        let source = self.paths(id)?.0;
        let mut attachments = vec![];
        for entry in entries {
            let entry = entry?;
            let Ok(name) = entry.file_name().into_string() else {
                continue;
            };
            if !valid_name(&name) || !entry.file_type()?.is_file() || entry.path() == source {
                continue;
            }
            attachments.push(Attachment {
                name,
                size: entry.metadata()?.len(),
            });
        }
        attachments.sort_by(|a, b| {
            a.name
                .to_lowercase()
                .cmp(&b.name.to_lowercase())
                .then_with(|| a.name.cmp(&b.name))
        });
        Ok(attachments)
    }

    /// Resolve only a regular attachment file belonging to this item.
    pub fn attachment_path(&self, id: &str, name: &str) -> Result<PathBuf> {
        ensure!(valid_name(name), "Invalid attachment filename");
        let dir = self.attachment_directory(id)?;
        let path = dir.join(name);
        ensure!(
            fs::symlink_metadata(&path)
                .context("Attachment does not exist")?
                .is_file(),
            "Attachment must be a regular file"
        );
        let path = path.canonicalize()?;
        ensure!(
            path.starts_with(&dir) && path != self.paths(id)?.0,
            "Invalid attachment path"
        );
        Ok(path)
    }

    /// Copy a file into the item, preserving existing files on filename collisions.
    pub fn attach_file(&self, id: &str, source: impl AsRef<Path>) -> Result<Attachment> {
        let source = source.as_ref();
        let name = source
            .file_name()
            .and_then(|name| name.to_str())
            .context("Missing or unsupported filename")?;
        ensure!(valid_name(name), "Invalid attachment filename");
        let mut input = fs::File::open(source).context("Could not open attachment")?;
        ensure!(input.metadata()?.is_file(), "Only files can be attached");
        let dir = self.attachment_directory(id)?;
        fs::create_dir_all(&dir)?;
        let mut temp = tempfile::Builder::new()
            .prefix(TEMP_PREFIX)
            .tempfile_in(&dir)?;
        let size = io::copy(&mut input, &mut temp).context("Could not copy attachment")?;
        temp.as_file().sync_all()?;
        let stem = Path::new(name)
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or(name);
        let extension = Path::new(name).extension().and_then(|ext| ext.to_str());
        let mut number = 1_u64;
        loop {
            let candidate = if number == 1 {
                name.to_owned()
            } else if let Some(extension) = extension {
                format!("{stem} ({number}).{extension}")
            } else {
                format!("{stem} ({number})")
            };
            match temp.persist_noclobber(dir.join(&candidate)) {
                Ok(_) => {
                    return Ok(Attachment {
                        name: candidate,
                        size,
                    });
                }
                Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => {
                    temp = error.file;
                    number += 1;
                }
                Err(error) => return Err(error.error.into()),
            }
        }
    }

    /// Remove the library's copy without touching the originally imported file.
    pub fn remove_attachment(&self, id: &str, name: &str) -> Result<()> {
        fs::remove_file(self.attachment_path(id, name)?)?;
        Ok(())
    }
}
