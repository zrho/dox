# Development workflow

- The project is in rapid flux. For now, prioritize implementation and iteration over testing, which would slow development at this stage.
- Do not add or run automated tests, or perform manual testing, unless the user explicitly requests it.
- The user will manually test changes. Leave existing tests in place; resume testing when the user asks.
- Be clear about any unverified behavior when reporting changes.

# Frontend dependencies

- Import Lucide icons from their individual public paths, such as `lucide-solid/icons/file-text`. Avoid the package-wide `lucide-solid` or `lucide-solid/icons` entry points: their catalog re-exports can make Vite development startup traverse the full icon library.
