import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseYouTubeId,
  buildYouTubeEmbedUrl,
  youTubeWatchUrl,
  validateOfficialEmbed,
} from "./video-embed.ts";

test("every YouTube URL shape resolves to the same id", () => {
  const id = "dQw4w9WgXcQ";
  for (const input of [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://youtu.be/${id}?t=42`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `www.youtube.com/watch?v=${id}`,
  ]) {
    assert.equal(parseYouTubeId(input), id, input);
  }
});

test("non-YouTube hosts are refused, not coerced", () => {
  // The failure mode this guards against: a lookalike host serving an iframe
  // we would then embed with our own page's trust.
  for (const input of [
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "https://vimeo.com/123456789",
    "https://example.com/embed/dQw4w9WgXcQ",
    "https://notyoutu.be/dQw4w9WgXcQ",
  ]) {
    assert.equal(parseYouTubeId(input), null, input);
  }
});

test("malformed ids are rejected rather than guessed at", () => {
  assert.equal(parseYouTubeId(null), null);
  assert.equal(parseYouTubeId(""), null);
  assert.equal(parseYouTubeId("   "), null);
  assert.equal(parseYouTubeId("short"), null);
  assert.equal(parseYouTubeId("waaaaaaaytoolongforanid"), null);
  assert.equal(parseYouTubeId("dQw4w9WgXc!"), null); // 11 chars, illegal char
  assert.equal(parseYouTubeId("https://www.youtube.com/watch"), null);
  assert.equal(parseYouTubeId("https://www.youtube.com/@RockstarGames"), null);
});

test("the embed URL is privacy-enhanced and never autoplays", () => {
  const url = buildYouTubeEmbedUrl("dQw4w9WgXcQ");
  assert.ok(url.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?"), url);
  assert.ok(!/autoplay/i.test(url), "autoplay must never be set");
  assert.ok(!/\bmute\b/i.test(url));
  assert.match(url, /(^|[?&])rel=0(&|$)/);
});

test("a start offset is passed through as whole seconds, and only when positive", () => {
  assert.match(buildYouTubeEmbedUrl("dQw4w9WgXcQ", { startSeconds: 90.7 }), /[?&]start=90(&|$)/);
  assert.ok(!/start=/.test(buildYouTubeEmbedUrl("dQw4w9WgXcQ", { startSeconds: 0 })));
  assert.ok(!/start=/.test(buildYouTubeEmbedUrl("dQw4w9WgXcQ", { startSeconds: -5 })));
  assert.ok(!/start=/.test(buildYouTubeEmbedUrl("dQw4w9WgXcQ", { startSeconds: NaN })));
});

test("URL builders refuse a non-id outright instead of emitting a broken iframe", () => {
  assert.throws(() => buildYouTubeEmbedUrl("https://youtu.be/dQw4w9WgXcQ"));
  assert.throws(() => youTubeWatchUrl("nope"));
  assert.equal(youTubeWatchUrl("dQw4w9WgXcQ"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
});

test("an embed without a named official channel is refused", () => {
  // The single load-bearing rule: an embed is legitimate because the
  // RIGHTS-HOLDER uploaded it. A video with no named channel could be a fan
  // re-upload, which carries no permission from anyone.
  const result = validateOfficialEmbed({
    videoUrlOrId: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Grand Theft Auto VI Trailer 1",
    channel: "  ",
  });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /official channel/i);
});

test("an embed without a real title is refused — it is the accessible name", () => {
  const result = validateOfficialEmbed({
    videoUrlOrId: "dQw4w9WgXcQ",
    title: "",
    channel: "Rockstar Games",
  });
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.reason : "", /title/i);
});

test("a fully-provenanced embed validates and normalises to a bare id", () => {
  const result = validateOfficialEmbed({
    videoUrlOrId: "https://youtu.be/dQw4w9WgXcQ?t=12",
    title: "Grand Theft Auto VI Trailer 1",
    channel: "Rockstar Games",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.embed.videoId, "dQw4w9WgXcQ");
    assert.equal(result.embed.provider, "youtube");
    assert.equal(result.embed.channel, "Rockstar Games");
  }
});

test("a non-YouTube provider is refused rather than silently treated as YouTube", () => {
  const result = validateOfficialEmbed({
    provider: "vimeo",
    videoUrlOrId: "dQw4w9WgXcQ",
    title: "x",
    channel: "y",
  });
  assert.equal(result.ok, false);
});
