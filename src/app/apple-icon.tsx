import { ImageResponse } from "next/og";

// TEMPORARY placeholder — see icon.tsx's header comment. Apple touch icons
// are shown without transparency (iOS flattens alpha against a background
// of its own), so this uses an opaque background deliberately.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#b45309",
          color: "#ffffff",
          fontSize: 84,
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        TC
      </div>
    ),
    { ...size }
  );
}
