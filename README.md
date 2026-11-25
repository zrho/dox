# dox

Dox is a local notes app for connected mathematical writing. The CLI and the Native Shell app for macOS share `dox-core`, which manages the library, metadata, links, file watching, and Typst compilation.

## Development tasks

Install the task runner with `cargo install cargo-make`. Run these commands from the repository root:

| Command | Action |
| --- | --- |
| `cargo make` | Build the Rust core and CLI. |
| `cargo make cli --library ~/Notes list` | Run the CLI with the given arguments. |
| `cargo make install-cli` | Install the CLI. |
| `cargo make dev` | Run the macOS app with hot reload. |
| `cargo make package` | Build the macOS app bundle in `target/dox-nsh-macos`. |
| `cargo make fmt` / `cargo make lint` | Format the Rust workspace or run Clippy on it. |

## macOS app

Install Native Shell 0.6.1, Rust, and the macOS Command Line Tools. From the repository root, run:

```sh
nsh run crates/dox-nsh --target macos
```

See the [macOS app guide](crates/dox-nsh/README.md) for packaging, installation, and keyboard shortcuts.

## CLI

Use a Rust toolchain that supports edition 2024. Install the CLI from the repository root:

```sh
cargo install --path crates/dox-cli
```

```sh
dox --library ~/Notes init
dox --library ~/Notes new 'Linear maps' --tags math
dox --library ~/Notes list --tag math
dox --library ~/Notes show ABC12
dox --library ~/Notes render ABC12 > /tmp/note.html
dox --library ~/Notes backlinks ABC12
```

Replace `ABC12` with the generated ID. `show` returns source, merged metadata, and a revision. `save ABC12 --revision REVISION` reads source from standard input and rejects the write if the revision has changed. Structured commands emit JSON; `render` emits HTML. Use `dox --help` for the full command list.

## Library format

The library path points to the folder that contains `notes/`. Each item has a directory named for its ID and a `meta.json` file. Only `type` and `document` are required in `meta.json`; `document` is relative to the item directory.

```text
Notes/
  notes/
    ABC12/
      meta.json
      note.typ
      attachments/    # optional
    XYZ89/
      meta.json
      reference.bib
  .cache/             # generated HTML and indexes
  .trash/             # deleted items
```

Typst notes use `dox:ID` links and can supply metadata with a `<dox>` label. Literature items contain one BibTeX entry whose citation key matches the item ID. Cite a literature item in Typst with `@XYZ89`. Daily notes use a date in `YYYY-MM-DD` format as the ID.

Dox embeds Typst with standard text and math fonts. A separate Typst installation is not required. The `TYPST_FONT_PATHS`, `TYPST_IGNORE_SYSTEM_FONTS`, `TYPST_PACKAGE_PATH`, and `TYPST_PACKAGE_CACHE_PATH` environment variables configure font and package resolution. First use of an uncached Typst Universe package requires internet access.
