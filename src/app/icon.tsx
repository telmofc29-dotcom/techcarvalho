import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Real TechCarvalho brand mark (Media asset id 4e62a81c-e32a-4775-99b1-c822949c09f1 /
// 502a294a-1dc4-444d-a402-9905a23072ef — "mark" brand_role), trimmed to its
// visible content and stored as a static derivative at public/brand/mark-trimmed.png
// (see that file's sibling generation script for how it was cropped — a
// lossless trim, no distortion). Replaces the earlier placeholder "TC" box.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
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
          borderRadius: 6,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse (Satori) requires a plain <img>, not next/image */}
        <img src={markSrc} width={26} height={18} alt="" />
      </div>
    ),
    { ...size }
  );
}
