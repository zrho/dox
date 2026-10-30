# dox

A local notes app for connected mathematical writing. Rust owns the library, metadata, links, filesystem watching, and Typst compilation; the CLI and SolidJS/Tauri desktop app share `dox-core`.

## Run

Building requires Rust (edition 2024), Node.js 22+, and macOS Command Line Tools. dox embeds Typst 0.15.1 through `typst-as-lib`, including standard text and math fonts. The desktop app and CLI compile notes in process; a separate Typst installation is no longer required. System fonts are discovered once per open library. `TYPST_FONT_PATHS`, `TYPST_IGNORE_SYSTEM_FONTS`, `TYPST_PACKAGE_PATH`, and `TYPST_PACKAGE_CACHE_PATH` configure font and package resolution. Uncached Typst Universe packages require internet access on first use.

```sh
cd crates/dox-gui
npm ci
npm run tauri dev
```

Open the command panel with ⌘⇧P and choose **Open library**, then choose an existing folder or create a folder in the native picker. The **New note** command or ⌘N immediately creates a note and focuses its editor with the `Untitled` heading selected. Type a heading, edit its Typst source, and save with ⌘S. Creating another note saves the current draft first. The eye icon saves the draft and switches to the rendered view; the pencil icon returns to the source. Use ⌘P to fuzzy-find notes by title or ID; use ↑/↓ and Enter to open, or Escape to dismiss. Items already open are focused and scrolled into view; other items open in a new pane. Existing panes and their drafts remain open. Use the **Copy note link or citation** command to connect an item from another note. Links and backlinks navigate between notes. ⌘B toggles the sidebar from the editor or rendered view. ⌘E toggles edit/view (saving before viewing); ⌘K in the editor opens the fuzzy picker to insert a note link at the cursor. Selected text becomes the link label; otherwise the target title is used. Link labels retain Typst syntax, including math.

The sidebar starts collapsed; use ⌘B to show pinned items. Note columns are at most 520px wide and scroll horizontally with a hidden scrollbar. Drag a pane by its title to reorder it; neighbouring panes slide aside and the pane settles into place on release. Drag near either edge to scroll, or press Escape to cancel. Reordering preserves open drafts and scroll positions, and animations respect reduced-motion preferences. Viewed content uses bundled Libertinus Serif; source editing uses JetBrains Mono.

Outside text fields, **h / ←** focuses the previous open pane and **l / →** the next, scrolling it into view in the current pane order and stopping at either end. These shortcuts preserve text entry and caret movement in editors, inputs, and editable content. **Escape** first dismisses error or warning messages; when editing a note, it saves and switches to view mode through the same action as ⌘E. In view mode it retains the existing pane/sidebar closing behavior. Dialogs keep their own Escape handling, and holding Escape does not cascade through several actions. Diagnostics remain separate from dismissible messages.

On macOS, toolbar actions share the native title-bar area with the traffic lights. Each note column has a compact footer below backlinks, showing its ID and date when known in both edit and view modes. Drag empty space in that row to move the window, or double-click it to use the system title-bar action. Changes to native window configuration require restarting the desktop app.

The desktop app enables [`tauri-plugin-macos-fps`](https://github.com/userFRM/tauri-plugin-macos-fps) to allow rendering at the display’s native refresh rate on macOS. The plugin uses a private WebKit API and is unsuitable for Mac App Store distribution.

On macOS, closing the last window keeps the app running. Click its Dock icon to open a window again. **File → New window**, ⌘⇧N, or the command panel creates another window, restoring the most recently used library. Each window has its own open library, panes, and drafts; switching libraries in one window leaves the others intact. Quit the app with ⌘Q.

The ⌘⇧P command panel fuzzy-finds app commands, shows their assigned keybindings, and supports ↑/↓, Enter, and Escape. Commands unavailable in the current context appear dimmed. Command labels and keybindings are defined centrally in `crates/dox-gui/src/utils/commands.json`, shared with the native menu.

To build a macOS app bundle:

```sh
cd crates/dox-gui
npm run tauri build
```

The output is under `target/release/bundle/macos/`. For a faster local build use `npm run tauri build -- --debug`; output is under `target/debug/bundle/macos/`. Distribution signing and notarization are not configured.

The app icon comes from `crates/dox-gui/src-tauri/icons/icon.png`. Tauri development and release builds generate the native icon set automatically in `icons/generated/` (Git-ignored). Replace the source PNG to change the icon, or run `npm run build:icons` in `crates/dox-gui` to regenerate it directly.

## CLI

Run from the repository root, or install with `cargo install --path crates/dox-cli`.

```sh
cargo run -p dox-cli -- --library ~/Notes init
cargo run -p dox-cli -- --library ~/Notes new 'Linear maps' --tags math
cargo run -p dox-cli -- --library ~/Notes list --tag math
cargo run -p dox-cli -- --library ~/Notes show ABC12
cargo run -p dox-cli -- --library ~/Notes render ABC12 > /tmp/note.html
cargo run -p dox-cli -- --library ~/Notes backlinks ABC12
cargo run -p dox-cli -- --library ~/Notes watch
```

Replace `ABC12` with an actual generated ID. `show` returns source, merged metadata, and a revision. `save ABC12 --revision REVISION` reads source from stdin and refuses to overwrite a changed revision. Structured commands emit JSON; `render` emits HTML. `list` also accepts `--search`.

## Library format

```text
Notes/
  .gitignore              # ignores /.cache/
  ABC12/
    meta.json
    note.typ
    attachments/           # optional files copied into the item
      paper.pdf
  .cache/                 # disposable HTML and metadata indexes
```

Only `type` and `document` are required in `meta.json`. The document path is relative to the note directory. Unknown note types remain readable and indexed; only Typst is rendered initially.

```json
{
  "type": "typst",
  "document": "note.typ",
  "title": "Linear maps",
  "tags": ["math"]
}
```

Content can supply metadata with a labelled Typst metadata element:

```typst
#metadata((
  title: "Linear maps",
  authors: ("Ada",),
  tags: ("math", "algebra"),
  date: "2026-10-29",
)) <dox>

= Linear maps

$ T(a u + b v) = a T(u) + b T(v) $

#link("dox:XYZ89")[Related idea]
```

Explicit `meta.json` fields override derived fields, including empty values, except dates: Typst and literature dates come from their source documents. Multiple `<dox>` metadata elements merge in document order. A rendered `#title` (HTML h1) or first level-one heading (HTML h2) supplies the displayed title when metadata does not override it; the ID is the final fallback. Titles may contain Typst markup and math. Compiled title HTML is cached in `.cache/ID/title.html` and the metadata index, and displayed in the tree, note pickers, and backlinks. Plain compiled text and the Typst title source remain available for search and link labels. Metadata title strings are compiled as standalone Typst markup, so document-local definitions are available in heading-derived titles but not metadata overrides. New Typst notes record today’s local date in their source with `#metadata("2026-10-29") <dox-date>`. Edit or remove that command to change or omit the date; the existing `#metadata((date: "2026-10-29")) <dox>` form also works, with `<dox-date>` taking precedence. Dates in `meta.json` no longer supply dates for Typst or literature items. Known dates appear as plain text beside the ID in each column’s bottom bar in both edit and view modes. Undated items have no placeholder or picker. Dates support `YYYY`, `YYYY-MM`, and `YYYY-MM-DD`. The CLI `dox --library ~/Notes date ABC12 2026-10-29 --revision REVISION` updates the source command with revision conflict protection. For literature, edit BibTeX’s `date` field or `year` and optional `month`/`day` fields; partial dates retain their precision. New literature items have no automatic date.

GUI-created notes have minimal metadata and derive their titles from their headings. CLI-created notes have explicit titles and tags; remove those fields from `meta.json` if you want content to own them. Edit metadata externally for now.

Links use `dox:ID`. The compiler resolves links, including computed destinations, for the index. A broken draft remains editable and can retain literal links as a best-effort fallback. Missing targets are retained and reported as dangling-link errors on save/read; malformed `dox:` destinations are reported as invalid-note-link errors. Links emitted through HTML show rules are also checked from compiled HTML. Other web links are currently inert in the note viewer. Literature items use the same generated IDs as citation keys; see below.

Clicking a note link, citation, or backlink focuses and reveals its existing pane, or appends a new pane at the end if the item is not open. All other panes and unsaved drafts remain open.

## Literature

To import a publication, open ⌘⇧P and choose **Import publication from link or tag**. Paste one DOI, arXiv ID, or link and press Enter. The dialog accepts bare DOIs, `doi:` prefixes, `doi.org` links, current and legacy arXiv IDs (including versions), arXiv abstract/PDF/HTML links, and publisher URLs containing a DOI. arXiv DOI links (`10.48550/arXiv.…`) also work. Internet access is required: DOI metadata comes through DOI content negotiation, and arXiv metadata comes from its Atom API. The Rust core resolves and validates the reference before creating a single-entry `reference.bib` with the item's generated ID as its citation key. The imported item opens in view mode without replacing other open drafts. Failed lookups leave the dialog open with an error and create no empty items. The empty-literature command remains available for manual entry.

arXiv imports also download the paper PDF into the item's attachments. The imported BibTeX records the resolved arXiv version so the metadata and downloaded paper agree. If the PDF download fails, the reference is still imported and a warning explains how to retry.

For an existing literature item, choose **Find and attach paper PDF** in the command panel. The core recognizes arXiv `eprint`/`archiveprefix` (or `eprinttype`), arXiv ID fields, URLs, and arXiv DOIs. Without an explicit arXiv identifier, it searches arXiv by title, preferring an exact DOI match in returned metadata; otherwise it requires an exact normalized title and an author surname match when authors are known. Ambiguous results are rejected. In edit mode the command uses the current BibTeX draft without saving or changing it. Only arXiv PDF sources are supported for now; provider resolution is separate from attachment storage in `crates/dox-core/src/publication_pdf.rs`.

PDF downloads stream to a temporary file with a 100 MB limit and a two-minute request timeout. Non-PDF and incomplete responses are rejected before attaching. A byte-identical PDF already attached to the item is reused. Failed attempts leave existing attachments intact. These operations are also available through `dox --library ~/Notes import-publication arXiv:2010.07763` and `dox --library ~/Notes find-paper-pdf ABC12` (the latter uses saved BibTeX).

Open the command panel with ⌘⇧P and choose **New empty literature item** to create a literature item, or run `dox --library ~/Notes literature`. Literature items appear alongside notes in the tree and Command-P picker. Edit their BibTeX source in the app or externally; saving checks the loaded revision as for notes.

Each item has `meta.json` containing `{"type":"literature","document":"reference.bib"}` and a BibTeX file with exactly one entry. Its key must equal the directory’s generated ID:

```bibtex
@article{ABC12,
  title = {A paper title},
  author = {Lovelace, Ada},
  year = {1843},
  journal = {Example Journal},
}
```

View mode shows a compact field table with right-aligned labels, including publication type, authors, publication details, identifiers, and any additional BibTeX fields. When present, the abstract appears as reading text below the table. The title appears in the column header, without a repeated heading or Title row in the body. Edit mode retains the BibTeX source. The title is derived from the BibTeX `title` field unless explicitly overridden in metadata. Use self-contained entries with braced, quoted, or numeric field values; BibTeX macros, comments outside the entry, and multi-entry imports are not supported by the item reader.

In a Typst note, write `@ABC12` (including optional Typst citation supplements), or `#cite(<ABC12>)`. Command-K inserts `@ABC12` when selecting a literature item, replacing the editor selection. Command-Shift-K inserts the publication title followed by `@ABC12`; special Typst characters in the title are escaped. Both shortcuts insert ordinary links when choosing notes. The command panel offers **Copy note link or citation**. dox generates a bibliography and compilation wrapper under `.cache` without modifying the note source. The generated bibliography is hidden in the rendered note; citations navigate to literature items and contribute backlinks. Hovering a citation or note link shows the target title in an app tooltip. Invalid BibTeX is reported in diagnostics and cannot be saved through the app; externally broken source remains editable.

## Attachments

Any item, including a literature item, can have file attachments. Click the paperclip in the toolbar or choose **Attach files to item** in the command panel, then select one or more files. Files are copied into the item's `attachments/` directory; the originals stay where they are. Duplicate filenames receive a numbered suffix, such as `paper (2).pdf`, without overwriting existing files.

You can also drag one or more files from your file manager onto a note or literature pane, in either edit or view mode. The pane under the pointer highlights as the attachment destination, even when another pane is active. Dropping uses the same copy and collision handling as the file picker and preserves editor drafts. File drops outside item panes or while an operation is busy are ignored.

Items with attachments show a collapsible **ATTACHMENTS** panel beneath backlinks in both edit and view modes. Click a filename to open it in the system's default application (for example, Preview for PDFs). The panel's plus button attaches more files, and its remove button asks before deleting the library's copy. Attaching or removing files preserves unsaved source edits. Files added or removed externally also refresh in the panel. Attachments move with the item when it is deleted or restored.

Attachments are ordinary files, with no manifest or metadata changes required. Supported filenames are single UTF-8 path components; subdirectories and symlinks are not listed or opened as attachments. Temporary import files are hidden until copying finishes. The core validates attachment paths before opening or removing them. The CLI also supports:

```sh
dox --library ~/Notes attach ABC12 ~/Downloads/paper.pdf
dox --library ~/Notes attachments ABC12
dox --library ~/Notes remove-attachment ABC12 paper.pdf
```

## Math and diagrams

Math renders as inline SVG through Typst’s `html.frame`, including equations in cached titles. The generated wrapper keeps inline equations within paragraphs and display equations as blocks; source files are unchanged. Cached HTML and titles regenerate when the rendering configuration changes. Wrap paged drawing content in `html.frame` to export it as inline SVG. For example:

```typst
#import "@preview/fletcher:0.5.8": diagram, node, edge

#html.frame[
  #diagram(
    node((0, 0), $A$),
    node((1, 0), $B$),
    edge((0, 0), (1, 0), "->", $f$),
  )
]
```

This Fletcher example (which uses CeTZ) has been compiled successfully with Typst 0.15.1. First use of an uncached package needs internet access. HTML export remains experimental in Typst; errors appear in the app without discarding source. The viewer renders sanitized HTML/MathML/SVG directly in a Shadow DOM, with no iframe or note scripts. Compiler style rules are scoped to that view; external stylesheet imports and rules targeting the host are discarded. Note links use delegated app navigation, and keyboard shortcuts bubble normally to the app.

## External edits and cache

Native filesystem notifications refresh the library, with a one-second polling fallback where native notifications are unavailable. Clean open notes reload automatically; dirty drafts remain intact and show a conflict notice. Saving checks both source and explicit metadata against the loaded revision. This protects ordinary external-edit conflicts; it is not a cross-process locking protocol for simultaneous writes.

Startup shows the cached note tree (or a lightweight source/metadata listing on first use) and refreshes it in the background. Per-note caches track source/metadata revisions, compiler settings, and file stamps from the embedded compiler’s per-compilation snapshot, including imports, packages, and assets. Changing one note does not recompile unrelated notes. Link-target diagnostics are rechecked independently of compilation. Failed compilations are cached until library inputs or compiler settings change. The index computes the library fingerprint once per pass, and per-note locks prevent duplicate concurrent compilation of the same note. Generated HTML and indexes live under `.cache`. Source documents and `meta.json` remain the source of truth. The app adds `/.cache/` and `/.trash/` to the library's `.gitignore`, preserving existing ignore rules. It never initializes or operates Git itself.

## Verify

```sh
cargo test -p dox-core -p dox-cli
cargo clippy --workspace --all-targets -- -D warnings
cd crates/dox-gui
npm run build
```

Existing integration tests still include a legacy external-Typst availability check; application rendering uses the embedded compiler. They cover creation, revision conflicts, merged metadata, computed links, math and SVG output, malformed notes, path containment, and external-change watching. AI, advanced reference management, cross-library links, and dedicated Git operations are deferred as specified in `TARGET.md`.

## Deletion and diagnostics

The toolbar trash icon moves the current note into library-local `.trash/`. An unsaved draft is saved first. **Undo** in the status bar restores the last deleted note; older deletions remain in `.trash/` until you manage them manually. Deletion checks the loaded revision, never rewrites incoming links, and leaves Git to record the removed note files. Referencing notes acquire dangling-link diagnostics; restoring a target clears those diagnostics on refresh.

```sh
dox --library ~/Notes delete ABC12 --revision REVISION
dox --library ~/Notes restore TRASH_ENTRY
dox --library ~/Notes diagnostics
dox --library ~/Notes diagnostics --id ABC12
```

`delete` returns a JSON object with `id` and `trash_entry`; pass the latter to `restore`. Restoration refuses to overwrite an existing note ID.

Structured diagnostics are available in `note.diagnostics` and `index.diagnostics`. Each diagnostic has a stable ID, `severity` (`error`, `warning`, or `proposal`), `code`, `message`, note/document identity, optional one-based line/column, optional target note, and an `actions` array for future suggested actions. The older `diagnostic` and `warnings` fields remain for compatibility.

Compile failures, invalid note storage, and missing/unreadable link targets are errors. Compiler warnings, unsupported note types, and invalid metadata dates are warnings. The compiler's experimental HTML notice and the deprecation notice for our query invocation are suppressed to avoid repeating infrastructure notices on every note. Proposals and suggested-action descriptions have model/UI support; no AI suggestions or action execution are implemented yet.

The compact diagnostics panel lists saved-file diagnostics across the library, filters by severity, expands compiler details, and opens the originating note in the editor. Source coordinates are used when they refer to that note's document; diagnostics from imported files preserve their file locations in the details. An error dot also marks affected sidebar notes. Broken drafts remain editable, and a compile failure is shown in the panel rather than as a duplicate modal/banner.
