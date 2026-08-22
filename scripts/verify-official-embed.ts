// Verifies, before anyone hand-writes an embed into an article, that a YouTube
// video really is what it is claimed to be.
//
// WHY THIS EXISTS
// ---------------
// The whole legitimacy of the embed route rests on one fact: the video was
// uploaded by the rights-holder. YouTube's Terms of Service grant "each other
// user of the Service a worldwide, non-exclusive, royalty-free licence to
// access your Content through the Service, and to use that Content ... only as
// enabled by a feature of the Service", and name the embeddable player as such
// a feature (<https://www.youtube.com/t/terms>). That licence flows from the
// UPLOADER. A fan re-upload of the same trailer carries no licence from
// anybody, and embedding one puts the infringement on our page.
//
// Eyeballing a channel name in the YouTube UI is exactly the kind of check
// that gets skipped. This makes it one command.
//
// WHAT IT ACTUALLY PROVES, AND WHAT IT DOES NOT
// ---------------------------------------------
// YouTube's public oEmbed endpoint returns the video's real title, its
// author_name and its author_url straight from YouTube. That is genuine
// evidence of WHICH CHANNEL uploaded it — it is not scraped, guessed, or
// remembered.
//
// It does NOT prove the channel is the publisher's official one. "Rockstar
// Games" as an author_name is a strong signal and the author_url
// (youtube.com/@RockstarGames) is checkable, but confirming that handle is
// Rockstar's own remains a human step — the same standing rule as
// rights_status = 'verified' everywhere else in this codebase.
//
// A non-200 from oEmbed means the video is unavailable, private, or not
// embeddable, and the embed must not be used. A 200 is consistent with the
// video being embeddable but is not documented by Google as an embeddability
// API, so this script reports it as a signal rather than a guarantee.
//
// Usage: npx tsx scripts/verify-official-embed.ts <url-or-id> [<url-or-id> ...]
// Reads and writes nothing. No credentials needed.

import { parseYouTubeId, buildYouTubeEmbedUrl, youTubeWatchUrl } from "../src/lib/media/video-embed";

const UA = "TechCarvalhoBot/1.0 (+https://www.techcarvalho.com)";

type OEmbed = {
  title?: string;
  author_name?: string;
  author_url?: string;
  provider_name?: string;
};

async function verify(input: string): Promise<boolean> {
  const id = parseYouTubeId(input);
  console.log(`\n--- ${input}`);
  if (!id) {
    console.error("  NOT A YOUTUBE VIDEO URL OR ID. Refusing to go further.");
    return false;
  }

  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    youTubeWatchUrl(id)
  )}&format=json`;

  let res: Response;
  try {
    res = await fetch(endpoint, { headers: { "User-Agent": UA } });
  } catch (e) {
    // Distinguishable from "the video is fine but not embeddable" — a network
    // failure is not a finding about the video.
    console.error(`  REQUEST FAILED (not a verdict on the video): ${(e as Error).message}`);
    return false;
  }

  if (!res.ok) {
    console.error(
      `  oEmbed returned ${res.status} ${res.statusText}. The video is unavailable, private, ` +
        `age-restricted or has embedding disabled. DO NOT EMBED IT.`
    );
    return false;
  }

  const data = (await res.json()) as OEmbed;
  console.log(`  id:      ${id}`);
  console.log(`  title:   ${data.title ?? "(none returned)"}`);
  console.log(`  channel: ${data.author_name ?? "(none returned)"}`);
  console.log(`  channel url: ${data.author_url ?? "(none returned)"}`);
  console.log(`  embed src:   ${buildYouTubeEmbedUrl(id)}`);
  console.log(
    `  STILL A HUMAN STEP: confirm ${data.author_url ?? "that channel"} is the publisher's own ` +
      `official channel before treating this as an authorised embed.`
  );
  return true;
}

async function main() {
  const inputs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (inputs.length === 0) {
    console.error("Usage: npx tsx scripts/verify-official-embed.ts <url-or-id> [<url-or-id> ...]");
    process.exitCode = 2;
    return;
  }
  let ok = true;
  for (const input of inputs) {
    if (!(await verify(input))) ok = false;
  }
  console.log("");
  // exitCode rather than process.exit(): tearing the process down while
  // fetch's handles are still closing trips a libuv assertion on Windows.
  process.exitCode = ok ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
