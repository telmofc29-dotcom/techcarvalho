import { ImageResponse } from "next/og";

// TEMPORARY placeholder brand asset — a plain "TC" monogram in the site's
// existing accent color, standing in until the real Canva-designed logo
// (full logo / compact mark / favicon exports) is dropped in. Swap this
// file's JSX (or replace it with a real icon.png export) once that's
// ready; nothing else in the app needs to change to pick it up, since
// every page inherits this favicon via Next's file-convention metadata.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 18,
          fontWeight: 700,
          fontFamily: "sans-serif",
          borderRadius: 6,
        }}
      >
        TC
      </div>
    ),
    { ...size }
  );
}
