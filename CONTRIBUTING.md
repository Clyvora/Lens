# Contributing to Clyvora Lens

Thanks for helping improve Clyvora Lens. Small, focused contributions are easiest to review.

## Before starting

- Search existing issues and pull requests before opening a duplicate.
- Open an issue before a large feature or architectural change so the direction can be discussed.
- Do not include private, personal, or proprietary file contents in issues, tests, screenshots, or pull requests.
- Use [SECURITY.md](SECURITY.md) instead of a public issue for vulnerabilities.

## Development setup

Use Node.js 22.12 or newer.

```bash
npm ci
npm run dev
```

Before submitting a pull request, run:

```bash
npm test
npm run lint
npm run build
```

## Project rules

- Keep all file parsing and conversion in the browser.
- Do not add a backend, authentication, analytics, cloud storage, external APIs, AI, remote fonts, or remote runtime assets.
- Never log file contents or include user data in error reporting.
- Keep parsing and conversion logic separate from UI components.
- Add or update focused tests for changes to parsing, validation, search, sorting, filtering, or conversion.
- Preserve keyboard access, visible focus states, mobile layouts, and `prefers-reduced-motion` behavior.
- Keep dependencies purposeful and explain new production dependencies in the pull request.

## Pull requests

Describe what changed, why it changed, how you tested it, and any privacy or performance impact. Include screenshots for visible UI changes, using only synthetic example data.

By contributing, you agree that your contribution is licensed under the project's PolyForm Shield License 1.0.0.
