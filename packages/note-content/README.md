# Note content

Source-only, dependency-free browser helpers imported by the independent desktop
and web reader builds. This directory owns Typst content styles, style scoping,
title fallback, and safe SVG/link preparation. Callers supply their DOMPurify
sanitizer using the exported options.

Keep application state, routing, scrolling, tooltips, native APIs, and application
layout in the consuming app. Changes here require rebuilding both frontends; the
web reader's generated bundle must be regenerated before rebuilding Rust exports.
