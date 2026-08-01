# Security Policy

## Supported versions

Only the latest commit on `main` is supported. This is a small, actively-developed
project — there are no maintained release branches to backport fixes to.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, use GitHub's private vulnerability reporting for this repository
(**Security** tab → **Report a vulnerability**), or open a draft security
advisory. Include:

- A description of the vulnerability and its potential impact
- Steps to reproduce, or a proof of concept
- Any suggested fix, if you have one

You should get an initial response within a few days. This project has no
paid security program or bounty, but confirmed reports will be credited in
the fix's changelog entry unless you'd prefer to stay anonymous.

## Scope notes

- Client-side app: the primary risk surface is XSS via untrusted API
  responses (TMDB/OMDb) rendered into the DOM, and any handling of
  user-supplied files (the Letterboxd CSV importer).
- The optional on-device AI model is loaded from a CDN at runtime and never
  sends data anywhere; the optional `worker/index.ts` `/api/recommend` route
  only ever forwards a pre-filtered candidate list, never raw user input, to
  Cloudflare Workers AI.
- `npm audit` is expected to report 0 vulnerabilities; Dependabot is
  configured for weekly npm checks.
