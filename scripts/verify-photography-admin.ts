// End-to-end check of /admin/photography against a RUNNING build.
//
//   npx next start -p 3111
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/verify-photography-admin.ts
//
// WHY THIS EXISTS
// ---------------
// "It compiles" has repeatedly not meant "it works" in this project. This
// signs in through @supabase/ssr itself — so the cookies are byte-for-byte the
// ones the app's own server client produces, not a hand-rolled imitation —
// loads the real page, then submits the real Server Action over HTTP exactly as
// a browser without JavaScript would, and re-reads the database to confirm the
// write landed. It sets a product to 'owned', verifies, then puts it back to
// 'unknown' and verifies again, so it leaves production as it found it.
//
// WRITES. It changes owner_access on one product and reverts it.

import { createServerClient } from "@supabase/ssr";
import { loadEnvLocal, createAdminClient } from "./_shared.ts";

loadEnvLocal();

const BASE = process.env.TC_VERIFY_BASE ?? "http://localhost:3111";

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

/** Sign in through @supabase/ssr so the cookie names/encoding match the app's exactly. */
async function adminCookieHeader(): Promise<string> {
  const jar = new Map<string, string>();
  const client = createServerClient(
    need("NEXT_PUBLIC_SUPABASE_URL"),
    need("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: (list) => {
          for (const c of list) jar.set(c.name, c.value);
        },
      },
    }
  );
  const { error } = await client.auth.signInWithPassword({
    email: need("TC_ADMIN_EMAIL"),
    password: need("TC_ADMIN_PASSWORD"),
  });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  if (jar.size === 0) throw new Error("sign-in produced no cookies — the session was not persisted.");
  return [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
}

async function getPage(cookie: string): Promise<string> {
  const res = await fetch(`${BASE}/admin/photography`, { headers: { cookie }, redirect: "manual" });
  if (res.status !== 200) {
    throw new Error(
      `GET /admin/photography returned ${res.status} ${res.headers.get("location") ?? ""} — ` +
        `expected 200. A redirect to /admin/login means the session was not accepted.`
    );
  }
  return res.text();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * The hidden $ACTION_* fields React renders so a form post reaches the right
 * Server Action WITHOUT JavaScript. Scoped to the form belonging to one
 * product — the admin header has its own sign-out action form, and posting
 * these fields at that one would exercise the wrong action entirely.
 */
function actionFieldsFor(html: string, productId: string): Record<string, string> {
  const marker = html.indexOf(`name="product_id" value="${productId}"`);
  if (marker === -1) throw new Error(`No access form rendered for product ${productId}.`);
  const start = html.lastIndexOf("<form", marker);
  const end = html.indexOf("</form>", marker);
  if (start === -1 || end === -1) throw new Error("Could not isolate the access form.");
  const form = html.slice(start, end);

  const fields: Record<string, string> = {};
  for (const m of form.matchAll(
    /<input type="hidden" name="(\$[^"]+)"(?: value="([^"]*)")?\s*\/?>/g
  )) {
    fields[decodeEntities(m[1])] = decodeEntities(m[2] ?? "");
  }
  if (Object.keys(fields).length === 0) {
    throw new Error("The access form has no $ACTION_* fields — it is not wired to a Server Action.");
  }
  return fields;
}

function count(html: string, needle: RegExp): number {
  return (html.match(needle) ?? []).length;
}

/** Reads the stat tiles rendered on the page, so we assert what a person sees. */
function tile(html: string, label: string): number {
  const re = new RegExp(
    `${label}</dt><dd[^>]*>(\\d+)</dd>`.replace(/\s+/g, "\\s*")
  );
  const m = html.match(re);
  if (!m) throw new Error(`Could not read the "${label}" tile from the page.`);
  return Number(m[1]);
}

/** Exactly what a browser with JavaScript disabled would post. */
async function submit(
  cookie: string,
  actionFields: Record<string, string>,
  fields: Record<string, string>
): Promise<{ status: number; body: string }> {
  const body = new FormData();
  for (const [k, v] of Object.entries(actionFields)) body.append(k, v);
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  const res = await fetch(`${BASE}/admin/photography`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body,
    redirect: "manual",
  });
  return { status: res.status, body: await res.text() };
}

async function main(): Promise<void> {
  const cookie = await adminCookieHeader();
  const db = await createAdminClient();

  console.log(`=== /admin/photography against ${BASE} ===\n`);

  const html = await getPage(cookie);
  console.log(`page loaded: ${html.length} bytes`);
  console.log(`  Products           ${tile(html, "Products")}`);
  console.log(`  Assessed           ${tile(html, "Assessed")}`);
  console.log(`  Not assessed       ${tile(html, "Not assessed")}`);
  console.log(`  Confirmed reachable${String(tile(html, "Confirmed reachable")).padStart(3)}`);
  console.log(`  Out of reach       ${tile(html, "Out of reach")}`);
  console.log(`  Photo requests     ${tile(html, "Photo requests")}`);
  console.log(`  access buttons on the page: ${count(html, /name="owner_access"/g)}`);
  console.log(`  progress bar rendered: ${html.includes('role="progressbar"')}`);

  console.log(`  44px touch targets on those buttons: ${count(html, /min-h-11 min-w-11/g)}`);

  // Pick the top-ranked row — the first product the triage order puts up.
  const firstRow = html.match(/name="product_id" value="([0-9a-f-]{36})"/);
  if (!firstRow) throw new Error("No access form found on the page.");
  const productId = firstRow[1];
  const actionFields = actionFieldsFor(html, productId);
  console.log(`  action fields on the top row: ${Object.keys(actionFields).join(", ")}\n`);

  const before = await db
    .from("products")
    .select("id, name, owner_access, owner_access_note, owner_access_set_at")
    .eq("id", productId)
    .single();
  if (before.error) throw new Error(`reading the product failed: ${before.error.message}`);
  console.log(
    `target: ${before.data.name}\n  before: owner_access=${before.data.owner_access} ` +
      `set_at=${before.data.owner_access_set_at ?? "null"}\n`
  );

  // --- 1. Reject a value outside the five --------------------------------
  const bad = await submit(cookie, actionFields, {
    product_id: productId,
    owner_access: "definitely_owned_trust_me",
    owner_access_note: "",
  });
  const stillUntouched = await db
    .from("products")
    .select("owner_access")
    .eq("id", productId)
    .single();
  if (stillUntouched.error) throw new Error(stillUntouched.error.message);
  console.log(
    `invalid value: HTTP ${bad.status}, rejected in body: ${bad.body.includes("is not an access state")}, ` +
      `db still ${stillUntouched.data.owner_access}`
  );
  if (stillUntouched.data.owner_access !== before.data.owner_access) {
    throw new Error("An invalid value CHANGED the database. That is a validation failure.");
  }

  // --- 2. Set it to 'owned' ----------------------------------------------
  const note = `verify-photography-admin ${new Date().toISOString()}`;
  const setRes = await submit(cookie, actionFields, {
    product_id: productId,
    owner_access: "owned",
    owner_access_note: note,
  });
  console.log(`set owned: HTTP ${setRes.status}`);

  const afterSet = await db
    .from("products")
    .select("owner_access, owner_access_note, owner_access_set_at")
    .eq("id", productId)
    .single();
  if (afterSet.error) throw new Error(afterSet.error.message);
  console.log(
    `  db now: owner_access=${afterSet.data.owner_access} ` +
      `set_at=${afterSet.data.owner_access_set_at} note=${JSON.stringify(afterSet.data.owner_access_note)}`
  );
  if (afterSet.data.owner_access !== "owned") throw new Error("owner_access did not become 'owned'.");
  if (!afterSet.data.owner_access_set_at) throw new Error("owner_access_set_at was not written.");
  if (afterSet.data.owner_access_note !== note) throw new Error("owner_access_note was not written.");

  const htmlAfter = await getPage(cookie);
  console.log(
    `  page now: Assessed ${tile(htmlAfter, "Assessed")}, ` +
      `Not assessed ${tile(htmlAfter, "Not assessed")}, ` +
      `Confirmed reachable ${tile(htmlAfter, "Confirmed reachable")}, ` +
      `progress bar: ${htmlAfter.includes('role="progressbar"')}`
  );
  if (tile(htmlAfter, "Assessed") !== tile(html, "Assessed") + 1) {
    throw new Error("The page's Assessed total did not move after the write.");
  }
  if (!htmlAfter.includes(note)) {
    throw new Error("The note is not visible on the reloaded page.");
  }

  // --- 3. Put it back -----------------------------------------------------
  const revertRes = await submit(cookie, actionFields, {
    product_id: productId,
    owner_access: "unknown",
    owner_access_note: "",
  });
  console.log(`\nrevert to unknown: HTTP ${revertRes.status}`);

  const afterRevert = await db
    .from("products")
    .select("owner_access, owner_access_note, owner_access_set_at")
    .eq("id", productId)
    .single();
  if (afterRevert.error) throw new Error(afterRevert.error.message);
  console.log(
    `  db now: owner_access=${afterRevert.data.owner_access} ` +
      `note=${JSON.stringify(afterRevert.data.owner_access_note)} ` +
      `set_at=${afterRevert.data.owner_access_set_at}`
  );
  if (afterRevert.data.owner_access !== "unknown") {
    throw new Error("Revert failed — the product is NOT back to 'unknown'.");
  }
  if (afterRevert.data.owner_access_note !== null) throw new Error("The note was not cleared.");
  // 'unknown' is the absence of an assessment, so it must carry no timestamp —
  // a dated 'unknown' would read as "someone looked and concluded nothing".
  if (afterRevert.data.owner_access_set_at !== null) {
    throw new Error("owner_access_set_at was left stamped on an unassessed product.");
  }

  const htmlFinal = await getPage(cookie);
  console.log(
    `  page now: Assessed ${tile(htmlFinal, "Assessed")}, ` +
      `Not assessed ${tile(htmlFinal, "Not assessed")}, ` +
      `progress bar: ${htmlFinal.includes('role="progressbar"')}`
  );
  if (tile(htmlFinal, "Assessed") !== tile(html, "Assessed")) {
    throw new Error("The page did not return to its starting totals.");
  }

  // --- 4. The action is not reachable without a session -------------------
  const anon = await submit("", actionFields, {
    product_id: productId,
    owner_access: "owned",
    owner_access_note: "",
  });
  const anonAfter = await db.from("products").select("owner_access").eq("id", productId).single();
  if (anonAfter.error) throw new Error(anonAfter.error.message);
  console.log(
    `\nno-session POST: HTTP ${anon.status}, db still ${anonAfter.data.owner_access}`
  );
  if (anonAfter.data.owner_access !== "unknown") {
    throw new Error("An unauthenticated POST changed the database.");
  }

  console.log("\nOK — every assertion passed and production is back to its starting state.");
}

main().catch((e) => {
  console.error("\nFAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
