# Browser-driving verification scripts

These drive a real browser with Playwright to verify behaviour that cannot be
checked any other way — that a form renders, that an upload reaches storage,
that a page does not throw during a Server Components render.

## Why this directory is excluded from tsconfig

Playwright is **not** a dependency of this project. It is available in the
development environment and is deliberately not added to `package.json`: it
would add hundreds of megabytes to every production install for something the
deployed site never runs.

`tsconfig.json` includes `**/*.ts`, and `next build` type-checks everything it
includes. A tracked `.ts` file importing an undeclared package therefore builds
fine locally — where Playwright happens to be present — and **fails on the
deployment host**, where `npm ci` installs only what `package.json` declares.

That is exactly what happened: a verification script was committed at
`scripts/verify-media-ingestion.ts`, the local build passed, the push
succeeded, and the deploy silently never landed. The site kept serving the
previous build for twenty minutes while everything looked green.

So: anything here that imports Playwright lives in `scripts/browser/`, which
`tsconfig.json` excludes. Run them with `npx tsx`, which does not consult that
exclusion.

Every other script stays under `scripts/` and keeps full type-checking.
