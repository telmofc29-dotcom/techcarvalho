# Catalogue expansion plan — first ~1,000 products

A planning document, not a populated catalogue — target counts and
priorities for building out the product database over time, using the
ingestion architecture in `src/lib/catalogue/import-types.ts` +
`scripts/ingest-catalogue.ts`. The first real slice (roughly 20–30 Canon
camera bodies) is being researched separately; this plan is what comes
after, and the rationale for sequencing it.

## Principle

Prioritise products that create real comparison, history, or search
value — generation chains (60D→70D→80D→90D), head-to-head pairs people
actually search ("X vs Y"), and categories with genuine buyer-guide
demand — over arbitrary breadth. A category with 15 well-connected
products (specs, relationships, real content linking to them) is more
valuable than 150 bare product stubs with no specs and no relationships.

## Target counts by category

| Category | Target count | Priority | Why |
|---|---|---|---|
| Cameras (bodies) | 120 | 1 | Core identity; structured specs prove the catalogue system; deep generation-chain/comparison value (Canon EOS DSLR + EOS R, then Nikon, Sony, Fujifilm equivalents) |
| Lenses | 150 | 2 | Every camera body needs lens context for buying-guide content; high commercial intent ("best lens for X body") |
| GPUs | 90 | 1 | Extremely high comparison/search intent; clean generation chains (each GPU generation vs the last); strong affiliate-readiness fit |
| CPUs | 70 | 2 | Same shape as GPUs, slightly lower per-SKU search volume outside enthusiast audiences |
| Gaming consoles | 25 | 1 | Small count but very high search volume per product; generation-vs-generation content writes itself |
| Drones | 60 | 2 | Genuine "old vs new" and buying-guide angles; FPV and camera-drone segments need separate treatment |
| FPV (frames/motors/components) | 50 | 3 | More specialist audience; build out once the drones vertical has traction |
| Action cameras | 40 | 2 | Clear generation chains (GoPro Hero N vs N-1), strong comparison content fit |
| Networking (routers/mesh/switches) | 80 | 2 | High "which do I actually need" buying-guide demand; ties into the home-networking content cluster |
| Storage (SSDs/HDDs/NAS) | 60 | 3 | Useful for PC-building content; lower urgency than GPUs/CPUs |
| Displays/TVs | 70 | 3 | Broad audience but crowded competitive space; worth doing once core verticals are solid |
| Phones | 100 | 4 (later) | Explicitly deferred — extremely competitive SEO space; only worth entering with real depth, not a token catalogue |
| Smart home | 60 | 4 (later) | Deferred until the core hardware verticals (cameras/computing/networking) are well-established |
| Robotics/AI hardware | 25 | 4 (later) | Emerging category; watch for real, sourceable products rather than speculative ones |

Total: ~1,000 across all categories; roughly 600 in Priority 1–2
categories, which is where effort should concentrate first.

## Sequencing

1. **Cameras (bodies) — Canon first, then Nikon/Sony/Fujifilm.** Already
   underway. Canon gives the deepest generation chains (DSLR xxD line,
   full-frame 5D/6D, EOS R mirrorless) to prove out
   `product_relationships` and the spec-definition vocabulary in
   `src/lib/catalogue/camera-specs.ts` before extending it to other
   camera brands, whose spec vocabularies mostly reuse the same
   definitions (sensor format, ISO range, etc. are brand-agnostic).
2. **GPUs and gaming consoles** — highest search-intent-per-product of
   any remaining category, and a genuinely distinct spec vocabulary
   worth defining early (a `camera-specs.ts`-equivalent
   `gpu-specs.ts`/`console-specs.ts`: memory, bus width, TDP, process
   node, launch MSRP, etc.).
3. **Lenses, CPUs, action cameras, networking** — fill out once the
   catalogue mechanics (import script, admin CRUD, product page
   rendering) have proven themselves against real cameras+GPUs data
   without needing further architecture changes.
4. **Drones/FPV, storage, displays** — same ingestion path, no new
   architecture expected; sequenced after the above mainly for editorial
   bandwidth reasons, not technical ones.
5. **Phones, smart home, robotics/AI hardware** — deliberately last.
   These are either extremely crowded (phones) or still maturing as real
   product categories (robotics/AI hardware) — worth doing properly
   later rather than half-heartedly now.

## What each new vertical needs before import

Per the pattern already used for cameras — do this once per vertical,
not once per product:

1. A normalized spec-definition vocabulary (like
   `CAMERA_SPEC_DEFINITIONS`) so imports never create near-duplicate
   `spec_definitions` rows from source-to-source naming variance.
2. Real research per product — manufacturer spec pages preferred,
   reputable specialist publications as fallback, exactly as documented
   for the camera research pass. No estimated/inferred specs.
3. Defensible `product_relationships` only (a real successor/generation,
   not "these are both newer than X").
4. `ProductFamilyImport` groupings where they add real navigational value
   (e.g. an "RTX 40 series" family), skipped where they wouldn't.

## Explicitly not planned this batch

No products were bulk-inserted into production in this batch — only the
Canon camera research (separate data files) and this plan exist right
now. Applying any of it to production is a deliberate, later step
requiring the ingestion script's `--apply` mode and real admin
credentials, which don't exist yet (see the batch's final report).
