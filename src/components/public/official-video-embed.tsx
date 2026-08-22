import { buildYouTubeEmbedUrl, youTubeWatchUrl, type OfficialVideoEmbed } from "@/lib/media/video-embed";

// An authorised official trailer embed.
//
// This is the answer to "a GTA VI article should show GTA VI". We cannot
// republish a screenshot or a piece of key art — see docs/gaming-media-routes.md
// for the per-publisher terms — but the publisher's own trailer, on the
// publisher's own channel, embedded through the platform's own player, is a
// distribution route the publisher opened themselves and can close at will.
//
// Nothing is copied to our storage. If Rockstar disables embedding or removes
// the video, this stops rendering the video, exactly as it should.
//
// DELIBERATE CHOICES
// ------------------
//  - `youtube-nocookie.com`, so no tracking cookie is set until play.
//  - No autoplay, ever. See video-embed.ts.
//  - `title` on the iframe: an iframe with no accessible name is announced as
//    just "frame" by a screen reader. This is the only name it gets.
//  - `loading="lazy"`: an embed below the fold costs a reader nothing until
//    they scroll to it. Player iframes are heavy.
//  - Aspect ratio held by CSS `aspect-video` on the wrapper with the iframe
//    absolutely filling it — no letterboxing, no layout shift on load.
//  - A plain link to the video on YouTube alongside it, so the embed is not
//    the only way to reach the source, and so the provenance claim ("this is
//    Rockstar's own upload") is checkable by the reader.
//
// WHAT YOUTUBE'S "REQUIRED MINIMUM FUNCTIONALITY" FORBIDS, AND WHY THIS
// COMPONENT LOOKS PLAIN
// ---------------------------------------------------------------------
// <https://developers.google.com/youtube/terms/required-minimum-functionality>
//   "You must not display overlays, frames, or other visual elements in front
//    of any part of a YouTube embedded player, including player controls.
//    Similarly, you must not use overlays, frames or other visual elements to
//    obscure any part of an embedded player."
// and, from the developer policies, do not "interfere with or obscure any
// attribution provided by YouTube, including attribution provided via or shown
// in embedded YouTube players."
//
// That rules out the tempting optimisation: a custom thumbnail with our own
// play button drawn over the iframe. If a click-to-load facade is ever wanted
// for performance, it must render INSTEAD OF the iframe, never on top of it.
// It is also why `modestbranding` is not set — stripping YouTube's branding is
// the same instinct pointed at the same rule.
//
// The same document sets a size floor: "Embedded players must have a viewport
// that is at least 200px by 200px", and for a 16:9 player "at least 480 pixels
// wide and 270 pixels tall". A fluid-width embed on a 375px phone cannot meet
// the 480px figure, which every responsive embed on the web has the same
// problem with; the absolute 200x200 floor IS enforced here via `min-h`.
// Recording the tension rather than pretending it away.
//
// NOT wired into any article yet — this is the component only.

export function OfficialVideoEmbed({
  embed,
  startSeconds,
  className = "my-6",
  priority = false,
}: {
  embed: OfficialVideoEmbed;
  startSeconds?: number;
  className?: string;
  /**
   * Set only for an embed that is the page's lead media and above the fold.
   * Turns off lazy loading, which would otherwise delay the one thing the
   * reader came for.
   */
  priority?: boolean;
}) {
  const src = buildYouTubeEmbedUrl(embed.videoId, { startSeconds });
  const watchUrl = youTubeWatchUrl(embed.videoId);

  return (
    <figure className={className}>
      {/* min-h-[200px] enforces YouTube's absolute 200x200 viewport floor at
          the narrowest breakpoint. Nothing is layered over this box. */}
      <div className="relative aspect-video min-h-[200px] w-full overflow-hidden rounded-xl bg-zinc-900">
        <iframe
          src={src}
          title={`${embed.title} — official video from ${embed.channel}, played on YouTube`}
          // Only what the player genuinely needs. No `autoplay` in the allow
          // list: the URL does not request it and the permission is not
          // granted either, so a future parameter change cannot switch it on.
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          loading={priority ? "eager" : "lazy"}
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
      <figcaption className="mt-2 text-xs text-zinc-500">
        {embed.caption && <span className="block text-zinc-600">{embed.caption}</span>}
        <span className="mt-1 block">
          {/* The provenance line is the point, not a footnote: it states whose
              video this is, which is the entire basis for embedding it. */}
          Official video by{" "}
          {embed.channelUrl ? (
            <a
              href={embed.channelUrl}
              rel="noopener noreferrer"
              target="_blank"
              className="underline decoration-dotted underline-offset-2 hover:text-zinc-700"
            >
              {embed.channel}
            </a>
          ) : (
            embed.channel
          )}
          <span aria-hidden="true"> · </span>
          <a
            href={watchUrl}
            rel="noopener noreferrer"
            target="_blank"
            className="underline decoration-dotted underline-offset-2 hover:text-zinc-700"
          >
            Watch on YouTube
          </a>
        </span>
      </figcaption>
    </figure>
  );
}
