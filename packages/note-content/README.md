# Note content

Source-only, dependency-free browser helpers used by the desktop app. This directory owns Typst content styles, style scoping,
title fallback, and safe SVG/link preparation. Callers supply their DOMPurify
sanitizer using the exported options.

Keep application state, routing, scrolling, tooltips, native APIs, and application
layout in the consuming app. Rebuild the desktop frontend after changes here.
