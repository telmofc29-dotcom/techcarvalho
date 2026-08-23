// Does a PUBLISHED translation leak into the English site?
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-locale-isolation.ts [baseUrl]
//
// Every public content query used to read content_items with no locale filter.
// An audit found 22 such sites; locale-scope.test.ts now lints for them. But a
// lint proves the filter is WRITTEN, not that it WORKS — the filter could name
// the wrong column, or the page could read from somewhere the lint does not
// cover.
//
// So this publishes the Portuguese translation, crawls the English site, checks
// it appears nowhere, and puts it back to draft. The revert runs in a finally
// block and is verified, because a probe that leaves a translation published is
// worse than no probe.
//
// SAFE ON PRODUCTION DATA: there is no /pt route yet, so a briefly published
// Portuguese article is reachable at no public URL at all. That is precisely
// the property being tested.

import { loadEnvLocal, createAdminClient } from "./_shared.ts";

loadEnvLocal();

const BASE = process.argv[2] ?? "http://localhost:3131";
const PT_SLUG = "geracoes-wifi-explicadas-do-wifi-4-ao-wifi-7";
const PT_TITLE_FRAGMENT = "cada geração mudou";

type Check = { name: string; passed: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, passed: boolean, detail: unknown) =>
  checks.push({ name, passed, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (t: string) => any };

async function text(path: string): Promise<string> {
  const r = await fetch(BASE + path, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    },
  });
  return r.ok ? r.text() : `__HTTP_${r.status}__`;
}

async function main(): Promise<void> {
  const db = (await createAdminClient()) as unknown as Db;

  const { data: row, error } = await db
    .from("content_items")
    .select("id, status, locale, translation_state")
    .eq("slug", PT_SLUG)
    .eq("locale", "pt")
    .maybeSingle();
  if (error) throw new Error(`reading the translation failed: ${error.message}`);
  if (!row) throw new Error(`no pt row at ${PT_SLUG}. Run scripts/create-first-translation.ts first.`);
  if (row.status !== "draft") throw new Error(`expected a draft, found status='${row.status}'. Refusing to touch it.`);

  let published = false;
  try {
    const { error: pubErr } = await db
      .from("content_items")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", row.id);
    if (pubErr) throw new Error(`could not publish the probe: ${pubErr.message}`);
    published = true;

    // Confirm it really is published, so a failed update cannot make the rest
    // of this report a vacuous pass.
    const { data: after } = await db.from("content_items").select("status").eq("id", row.id).maybeSingle();
    record("the translation is genuinely published for the duration of this test", after?.status === "published", {
      status: after?.status,
    });

    const pages: [string, string][] = [
      ["/", "the homepage"],
      ["/articles", "the articles list"],
      ["/articles?page=2", "articles page 2"],
      ["/search?q=wifi", "search for 'wifi'"],
      ["/search?q=geracoes", "search for a Portuguese word"],
      ["/computing", "a category hub"],
      ["/manufacturers/tp-link", "a manufacturer hub"],
      ["/sitemap.xml", "the sitemap"],
    ];

    for (const [path, label] of pages) {
      const body = await text(path);
      if (body.startsWith("__HTTP_")) {
        record(`${label} loaded`, false, body);
        continue;
      }
      const bySlug = body.includes(PT_SLUG);
      const byTitle = body.includes(PT_TITLE_FRAGMENT);
      record(
        `${label} does not surface the Portuguese article`,
        !bySlug && !byTitle,
        { slugFound: bySlug, titleFound: byTitle }
      );
    }

    // The English original must be unaffected — this is the getArticleDetail
    // multi-row hazard, now that a sibling with the same group is published.
    const en = await text("/articles/wifi-generations-explained-wifi-4-to-wifi-7");
    record(
      "the ENGLISH article still renders while its translation is published",
      !en.startsWith("__HTTP_") && en.includes("What Each Generation Actually Changed"),
      en.startsWith("__HTTP_") ? en : "renders"
    );

    // And the Portuguese article has no public URL of its own yet.
    const pt = await text(`/articles/${PT_SLUG}`);
    record(
      "the Portuguese slug 404s on the English route",
      pt.startsWith("__HTTP_404"),
      pt.startsWith("__HTTP_") ? pt : "RENDERED — it should not have"
    );
  } finally {
    if (published) {
      const { error: revErr } = await db
        .from("content_items")
        .update({ status: "draft", published_at: null })
        .eq("id", row.id);
      const { data: back } = await db.from("content_items").select("status").eq("id", row.id).maybeSingle();
      record(
        "the translation was put back to draft",
        !revErr && back?.status === "draft",
        { error: revErr?.message ?? null, status: back?.status }
      );
    }
  }

  let pass = 0;
  for (const c of checks) {
    if (c.passed) pass++;
    console.log(`[${c.passed ? "PASS" : "FAIL"}] ${c.name}`);
    console.log(`       ${c.detail}`);
  }
  console.log(`\n${pass}/${checks.length} checks passed.`);
  if (pass !== checks.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("verification failed to run:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
