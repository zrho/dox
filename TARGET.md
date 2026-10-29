- Product and scope
  - Build `dox`, a Zettelkasten-like notes app.
  - MVP: create, edit, and browse linked notes with tags and backlinks.
  - Initially single-user and local, with macOS as the priority platform.
  - Support one library initially; leave room for multiple libraries later.
  - Keep library files suitable for Git backup; dedicated Git integration comes later.
  - Deletion, reference-management features, and AI features are outside the MVP.

- Architecture
  - Rust native backend, with shared functionality in the `dox-core` library crate.
  - `dox-cli` exposes core functionality through a CLI.
  - `dox-gui` provides a Tauri app with a TypeScript and SolidJS frontend.
  - Future AI functionality lives in `dox-core` and is exposed through both CLI and GUI; behavior will be specified later.

- Library and storage
  - Store notes in the filesystem, with one directory per note.
  - Each note has a randomly generated ID matching `[0-9A-Z]{5}`, unique within its library.
  - Each note contains one source document and a `meta.json` referencing that document.
  - Required metadata: note type and source document reference.
  - Support optional metadata such as title, authors, date, and tags.
  - Support deriving metadata from document content, merging it with explicit metadata, and caching the merged result.
  - Store generated files and caches outside version control; a Git-ignored `.cache` directory within the library is acceptable.
  - Watch library files for external changes and update the app accordingly.
  - Leave room for future note types, multiple libraries, and cross-library references qualified by a library ID.

- Note content and connections
  - Typst is the default writing format, compiled to HTML for viewing.
  - Prioritize working math and diagram support, including packages such as CeTZ and Fletcher.
  - HTML output need not reproduce PDF layout exactly.
  - Support links between notes, tags, and backlinks.
  - Initially express note links as ordinary links in Typst; frontend JavaScript turns them into in-app navigation actions.
  - Future reference notes contain one bibliographic reference per note, using BibTeX.
    - Use the note's generated ID as its citation key.
    - Citations from Typst notes should support navigation and backlinks similarly to ordinary note links.

- Editing and UI
  - Support editing both inside dox and in external editors.
  - GUI switches between editing and viewing modes; live preview is not required.
  - Use Kobalte headless components, Tailwind CSS, and custom design-system components as needed.
  - Take visual inspiration from Zed: clean lines, compact and functional controls, content-first presentation, and unobtrusive UI.
