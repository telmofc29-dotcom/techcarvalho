// MEASURE ASSETS WHOSE DIMENSIONS WERE NEVER RECORDED.
//
// Downloads the first 64 KiB of each unmeasured asset and reads the real
// dimensions out of its header. The number written is the number in the image.
//
// It will NOT infer from a filename. Both of the currently unmeasured assets are
// named "1280px-...", which is exactly the sort of thing that invites a guess;
// a filename is a claim somebody typed, not a measurement.
//
//   TC_ADMIN_EMAIL=... TC_ADMIN_PASSWORD=... npx tsx scripts/backfill-image-dimensions.ts
//   ... --apply

import { loadEnvLocal, createAdminClient } from "./_shared.ts";
import { readImageDimensions, isPlausible } from "../src/lib/media/image-dimensions.ts";
import { MEDIA_PRIVATE_BUCKET, MEDIA_PUBLIC_BUCKET } from "../src/lib/media/constants.ts";

loadEnvLocal();
const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  const db = await createAdminClient();
  const { data, error } = await db
    .from("media_assets")
    .select("id, storage_path, public_storage_path, publication_status, media_type, width, height");
  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as Record<string, unknown>[]).filter(
    (a) => typeof a.width !== "number" || typeof a.height !== "number"
  );
  console.log(`assets with no recorded dimensions: ${rows.length} of ${(data ?? []).length}\n`);

  let measured = 0;
  let unreadable = 0;
  for (const a of rows) {
    const id = String(a.id);
    const file = (String(a.storage_path).split("/").pop() ?? "").replace(/^[0-9a-f-]{36}-?/i, "");
    if (String(a.media_type) !== "image") {
      console.log(`  SKIP      ${file}  (media_type=${a.media_type}, not an image)`);
      continue;
    }

    // Prefer the public copy when there is one; fall back to the private
    // original, which is the permanent archive.
    const attempts: [string, string][] = [];
    if (a.public_storage_path) attempts.push([MEDIA_PUBLIC_BUCKET, String(a.public_storage_path)]);
    attempts.push([MEDIA_PRIVATE_BUCKET, String(a.storage_path)]);

    let dims = null;
    let from = "";
    for (const [bucket, path] of attempts) {
      const { data: blob, error: dlError } = await db.storage.from(bucket).download(path);
      if (dlError || !blob) continue;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      dims = readImageDimensions(bytes.subarray(0, 65536));
      if (dims) { from = bucket; break; }
    }

    if (!isPlausible(dims)) {
      unreadable++;
      console.log(`  UNREADABLE ${file}  — header not recognised; left NULL rather than guessed`);
      continue;
    }

    const ratio = (dims.width / dims.height).toFixed(2);
    console.log(`  MEASURED  ${file}`);
    console.log(`            ${dims.width}x${dims.height} (${dims.format}, ratio ${ratio}) read from ${from}`);
    if (apply) {
      const { error: upError } = await db
        .from("media_assets")
        .update({ width: dims.width, height: dims.height })
        .eq("id", id);
      if (upError) { console.log(`            WRITE FAILED ${upError.message}`); continue; }
    }
    measured++;
  }

  console.log(`\n  ${apply ? "recorded" : "measurable"}: ${measured}   unreadable: ${unreadable}`);
  if (!apply) console.log("  REPORT ONLY — re-run with --apply");
}

main().catch((e) => { console.error(e); process.exit(1); });
