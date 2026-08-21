import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Real TechCarvalho brand mark — see icon.tsx's header comment. Apple touch
// icons are shown without transparency (iOS flattens alpha against a
// background of its own), so this uses an opaque white background
// deliberately, same as icon.tsx.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const markPath = join(process.cwd(), "public", "brand", "mark-trimmed.png");
  const markData = await readFile(markPath);
  const markSrc = `data:image/png;base64,${markData.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#ffffff",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse (Satori) requires a plain <img>, not next/image */}
        <img src={markSrc} width={132} height={90} alt="" />
      </div>
    ),
    { ...size }
  );
}
