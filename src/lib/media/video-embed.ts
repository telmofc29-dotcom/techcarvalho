// Authorised official video embeds — the one route that legitimately shows a
// GAME (as opposed to gaming hardware) on this site.
//
// WHY THIS EXISTS
// ---------------
// Console hardware is photographable, and freely-licensed photographs of the
// PS5, Xbox Series X/S and Switch 2 are already live here via Wikimedia
// Commons. GAMES are not. A screenshot or a piece of key art from GTA VI,
// Modern Warfare 4 or Mario Kart World is an all-rights-reserved creative work
// belonging to its publisher, and no publisher researched in
// docs/gaming-media-routes.md grants a commercial third-party site the right
// to republish one. Downloading a trailer frame and serving it from our own
// bucket is republication and is not available to us.
//
// Embedding is a DIFFERENT act. We do not copy the asset: the publisher
// uploaded the trailer to their own official channel, the platform serves it
// from the publisher's own upload, and the publisher can revoke it at any time
// by disabling embedding or deleting the video. The permission chain runs
// publisher -> platform -> embedder, and it is the publisher's own act of
// publishing that starts it.
//
// WHAT THIS MODULE WILL AND WILL NOT DO
// -------------------------------------
// It refuses to build an embed unless the caller names the official channel
// the video comes from. That is the whole safeguard: "a YouTube video of GTA
// VI" is a fan re-upload as often as not, and a fan re-upload carries no
// permission from anybody. Nothing here can verify that the named channel is
// genuinely the publisher's — that is a human check, recorded in the caller's
// data, exactly as `rights_status = 'verified'` is elsewhere in this codebase.
//
// Nothing here grants rights. See src/lib/media/hierarchy.ts for the same
// caveat on tiers.

/** A video we are embedding, with the provenance a reader is owed. */
export type OfficialVideoEmbed = {
  provider: "youtube";
  /** The bare platform video id, not a URL. */
  videoId: string;
  /** Real, descriptive title — becomes the iframe's accessible name. */
  title: string;
  /**
   * The official channel that published it, e.g. "Rockstar Games".
   * Required: an embed's legitimacy rests entirely on the upload being the
   * rights-holder's own.
   */
  channel: string;
  /** Canonical URL of the channel, so the claim above is checkable. */
  channelUrl?: string;
  /** Editorial line explaining what the reader is looking at. */
  caption?: string;
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** youtube-nocookie.com: Google's own "privacy-enhanced mode" host. */
const YOUTUBE_NOCOOKIE_ORIGIN = "https://www.youtube-nocookie.com";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
  "youtu.be",
  "www.youtu.be",
]);

/**
 * Extract a YouTube video id from an id or any of YouTube's URL shapes.
 *
 * Returns null rather than guessing. A wrong id renders someone else's video
 * under our headline, which is a correctness problem before it is a rights
 * one, so every path here is exact-match.
 */
export function parseYouTubeId(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;

  // Already a bare id.
  if (YOUTUBE_ID.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  // youtu.be/<id>
  if (host === "youtu.be" || host === "www.youtu.be") {
    return candidate(url.pathname.split("/")[1]);
  }

  // /watch?v=<id>
  const v = url.searchParams.get("v");
  if (v) return candidate(v);

  // /embed/<id>, /shorts/<id>, /live/<id>, /v/<id>
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 2 && ["embed", "shorts", "live", "v"].includes(segments[0])) {
    return candidate(segments[1]);
  }

  return null;
}

function candidate(value: string | undefined): string | null {
  if (!value) return null;
  return YOUTUBE_ID.test(value) ? value : null;
}

export type YouTubeEmbedOptions = {
  /**
   * Start offset in whole seconds. Only for pointing a reader at the moment
   * the article is discussing — never used to excerpt around the publisher's
   * branding.
   */
  startSeconds?: number;
};

/**
 * Build the embed src.
 *
 * Deliberate parameter choices, each one a decision rather than a default:
 *  - `youtube-nocookie.com` host — Google's privacy-enhanced mode, so no
 *    tracking cookie is set until the reader actually plays the video.
 *  - NO `autoplay`. A trailer that starts itself is hostile, burns the
 *    reader's data, and on a page about a game it is indistinguishable from
 *    an ad.
 *  - `rel=0` — keeps end-screen suggestions inside the same channel rather
 *    than throwing the reader at unrelated uploads. (YouTube reinterpreted
 *    this parameter in 2018: it no longer removes related videos, it
 *    restricts them to the same channel. Set for that reduced meaning.)
 *  - `modestbranding` is NOT set. It was deprecated by YouTube, and stripping
 *    the publisher's branding off the player would be the wrong instinct
 *    anyway: the branding is what tells the reader whose video this is.
 *  - No `origin`/JS API. This is a plain iframe with no player API, so there
 *    is nothing to postMessage to and no extra script to load.
 */
export function buildYouTubeEmbedUrl(videoId: string, options: YouTubeEmbedOptions = {}): string {
  if (!YOUTUBE_ID.test(videoId)) {
    throw new Error(`Not a YouTube video id: ${JSON.stringify(videoId)}`);
  }
  const params = new URLSearchParams({ rel: "0" });
  const start = options.startSeconds;
  if (typeof start === "number" && Number.isFinite(start) && start > 0) {
    params.set("start", String(Math.floor(start)));
  }
  return `${YOUTUBE_NOCOOKIE_ORIGIN}/embed/${videoId}?${params.toString()}`;
}

/** Where a reader goes to watch it on the platform itself. */
export function youTubeWatchUrl(videoId: string): string {
  if (!YOUTUBE_ID.test(videoId)) {
    throw new Error(`Not a YouTube video id: ${JSON.stringify(videoId)}`);
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export type EmbedValidation = { ok: true; embed: OfficialVideoEmbed } | { ok: false; reason: string };

/**
 * Gate an embed before it is rendered.
 *
 * Mirrors evaluatePublishEligibility() in src/lib/media/rights.ts: the point
 * is that the missing piece is named out loud instead of the component
 * quietly rendering something half-provenanced.
 */
export function validateOfficialEmbed(input: {
  provider?: string;
  videoUrlOrId?: string | null;
  title?: string | null;
  channel?: string | null;
}): EmbedValidation {
  if ((input.provider ?? "youtube") !== "youtube") {
    return { ok: false, reason: `Unsupported embed provider: ${input.provider}` };
  }
  const videoId = parseYouTubeId(input.videoUrlOrId);
  if (!videoId) {
    return { ok: false, reason: "Not a recognisable YouTube video URL or id." };
  }
  const title = (input.title ?? "").trim();
  if (!title) {
    return {
      ok: false,
      reason: "An embed needs a real title — it is the iframe's accessible name, not decoration.",
    };
  }
  const channel = (input.channel ?? "").trim();
  if (!channel) {
    return {
      ok: false,
      reason:
        "Name the official channel this video was published on. An embed is legitimate because the rights-holder uploaded it; an unattributed video could be a fan re-upload, which carries no permission.",
    };
  }
  return { ok: true, embed: { provider: "youtube", videoId, title, channel } };
}
