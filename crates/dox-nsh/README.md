# dox NSH

An experimental macOS reader for dox libraries. Native Shell provides the AppKit workspace, `dox-core` supplies the index and Typst output, and an isolated web view displays rendered notes. The Tauri GUI is a separate app.

## Run

Install Native Shell 0.6.1, Rust, and the macOS Command Line Tools. From the repository root:

```sh
nsh run crates/dox-nsh --target macos
```

The first run builds the native host and generates TypeScript declarations. Press ⌘⇧P, choose **Open library**, and select a copy of an existing dox library (the folder that contains `notes/`). The app remembers the last successfully opened library and reopens it on launch. The app writes library caches even when you do not edit notes.

Press ⌘P to find a note by title or ID. Use ↑/↓ and Enter to open it. Notes, links, citations, and backlinks reveal an existing column or open a new column on the right. Use J/K or ←/→ to focus adjacent columns, add Shift to move a column, and press Escape to close the focused column. Use **Edit** in the pane footer or press E to edit source. Press ⌘S to save, or Escape to save and return to the preview. External changes refresh the index and clean panes. If the saved file changes while you have an unsaved draft, the app keeps your draft and checks the saved revision before it writes. Use **Reload focused note from disk** to discard a draft and load the saved file.

Press ⌘N for a new note, ⌘⇧D for today’s note, or ⌘K in a Typst draft to insert a link or citation. The command panel also opens empty literature items and imports publications from a DOI, an arXiv ID, a link, or a BibTeX file.

Use **Attach files to item** or drop local files onto a note pane to copy files into it. The attachment panel opens files in the system’s default app and can remove the library’s copy. Use **Find and attach paper PDF** on a literature pane to find an arXiv PDF.

**Sync now** saves open drafts, then syncs the library’s Git repository. Configure the repository, upstream, identity, and authentication outside dox. **Enable automatic sync** is off by default and is remembered for each library. When enabled, the app waits at least ten minutes after opening the library, enabling the option, or editing a draft. While the library stays idle, it attempts to sync no more than once every five minutes. **Disable automatic sync** stops future attempts.

Drag-to-reorder is not available in this version.
