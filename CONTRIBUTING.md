# Contributing to CineMatch

Issues and PRs are welcome. This doc covers the workflow the short
"Contributing" section in the README doesn't have room for.

## Before you start

For anything more than a small fix, open an issue first describing what
you want to change and why — it's a much faster path than a PR that
turns out to conflict with a design decision already made for a reason
(there are several documented in the README's Architecture section;
skim it before assuming something is an oversight rather than
deliberate).

## Project constraints (read before writing UI code)

- **No framework.** This is deliberately vanilla TypeScript + Vite — see
  the README's Stack section for why. New UI goes through
  `src/lib/dom.ts`'s `el()` helper, not React/Svelte/a template compiler
  or a new UI dependency.
- **Strict TypeScript, zero `any`** outside the two isolated
  worker-boundary casts that already exist. New code should not add a
  third.
- **Shared UI goes in a shared module.** If a piece of markup is used by
  more than one screen (see `providers-ui.ts`, `credits-ui.ts`,
  `rating-ui.ts`), it belongs in its own `src/lib/*-ui.ts` module, not
  duplicated in each screen.
- **Nothing leaves the browser except TMDB/OMDb API calls.** No new
  analytics, telemetry, or third-party call that isn't one of the
  documented Connectors in the README. If your change needs one, say so
  explicitly in the PR description — see PRIVACY.md.

## Local setup

```bash
npm install
cp .env.example .env
# fill in VITE_TMDB_TOKEN at minimum — see README Setup section
npm run dev
```

## Before opening a PR

```bash
npm run typecheck   # must be clean — strict mode, no exceptions, covers src/ and worker/
npm run build        # must succeed
```

There's no automated test suite yet — manual verification against the
dev server is expected. Call out in the PR description what you tested
(which screens, light/dark, roughly what devices/browsers if the change
touches the on-device AI or WebGPU/WASM paths).

## Commit / PR style

- Keep PRs scoped to one change. A refactor and a new feature in the
  same PR is harder to review and harder to revert if one half needs to
  be undone.
- Update `CHANGELOG.md` for anything user-visible — see existing entries
  for the format (Added / Changed / a short "why", not just "what").
- If you touched a file listed in the README's Architecture section and
  the one-line description there is now wrong, update it in the same
  PR.

## What's especially welcome

- Bug reports with reproduction steps, especially anything region- or
  locale-specific (streaming-provider data genuinely varies by country
  — see `region.ts` — so "doesn't match what I see locally" reports are
  useful even when they turn out to be JustWatch data gaps rather than
  app bugs).
- Accessibility fixes — keyboard navigation and screen-reader labeling
  haven't had a dedicated audit pass.
- Performance regressions caught by bundle-size or load-time changes.

## What's out of scope (for now)

- A backend/server account system. The local-profile approach
  (`profile.ts`) is a deliberate design choice, not a placeholder — see
  its file header for the reasoning. Proposals to add server accounts
  should start as an issue, not a PR.
- New UI frameworks or state-management libraries.

## Code of conduct

This project follows the Contributor Covenant — see
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## Reporting a security issue

Do not open a public issue for security vulnerabilities — see
[SECURITY.md](./SECURITY.md) for the reporting process.
