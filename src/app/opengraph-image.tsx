import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SITE_TAGLINE } from "@/lib/seo/site";

// Real, TechCarvalho-owned site-wide default OG/social share image — see
// icon.tsx's header comment on provenance. Used by any page that doesn't
// set its own page-specific image (buildMetadata's `image` param, wired for
// products/articles with a real hero image). Keep key content within the
// safe-center ~1200x600 — some platforms crop the outer edges of the full
// 1200x630 canvas.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const logoPath = join(process.cwd(), "public", "brand", "logo-full-trimmed.png");
  const logoData = await readFile(logoPath);
  const logoSrc = `data:image/png;base64,${logoData.toString("base64")}`;
  // Source is 1400x367 (≈3.81:1) — scale to a comfortable OG width, no distortion.
  const logoWidth = 640;
  const logoHeight = Math.round(logoWidth / (1400 / 367));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          background: "#ffffff",
          padding: "80px 100px",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse (Satori) requires a plain <img>, not next/image */}
        <img src={logoSrc} width={logoWidth} height={logoHeight} alt="" style={{ marginBottom: 40 }} />
        <div style={{ fontSize: 30, color: "#71717a", fontFamily: "sans-serif", display: "flex" }}>
          {SITE_TAGLINE}
        </div>
      </div>
    ),
    { ...size }
  );
}
