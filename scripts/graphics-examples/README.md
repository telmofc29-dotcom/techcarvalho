# Example graphic specs

Input files for `node scripts/generate-editorial-graphics.mjs --spec scripts/graphics-examples/`.

They exist to document the spec shape and to smoke-test the renderers. **The subjects are
deliberately fictional placeholders** ("Example Camera A", "Example Sensor Module") and the
`provenance.sourceLabel` on each one says so explicitly. Nothing in this directory makes a claim
about a real product — a sample file carrying invented numbers under a real model name would be
exactly the fabrication the generator exists to prevent, even sitting unused in the repo.

Every one of them also demonstrates a **gap**: a `null` value that renders as a visible
"not published" marker rather than a zero, a dash, or an interpolated line.

When you write a real spec:

- put every figure in the spec file — the generator has no other source of data;
- write `null` for anything you do not have, and never a guess;
- fill in `provenance.sourceLabel` with the actual source, and `provenance.asOf` with the date you
  checked it;
- do not add `owned`, `rights_status`, `source_type`, `ai_generated`, `license`, `attribution` or
  `creator` — the generator rejects any spec containing them, because it emits its own rights
  literals for work it actually drew.
