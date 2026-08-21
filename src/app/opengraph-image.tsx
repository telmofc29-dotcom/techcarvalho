import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/seo/site";

// TEMPORARY site-wide default OG/social share image — see icon.tsx's
// header comment. Used by any page that doesn't set its own page-specific
// image (buildMetadata's `image` param, wired for products/articles with a
// real hero image). Keep key content within the safe-center ~1200x600 —
// some platforms crop the outer edges of the full 1200x630 canvas.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 88,
            height: 88,
            borderRadius: 16,
            background: "#b45309",
            color: "#ffffff",
            fontSize: 40,
            fontWeight: 700,
            fontFamily: "sans-serif",
            marginBottom: 40,
          }}
        >
          TC
        </div>
        <div style={{ fontSize: 56, fontWeight: 700, color: "#18181b", fontFamily: "sans-serif", display: "flex" }}>
          {SITE_NAME}
        </div>
        <div style={{ fontSize: 30, color: "#71717a", fontFamily: "sans-serif", marginTop: 16, display: "flex" }}>
          {SITE_TAGLINE}
        </div>
      </div>
    ),
    { ...size }
  );
}
