import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "apjwzxnvjvffnbpmubqu.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
    // AVIF first, WebP as the fallback. The default is WebP only, which left
    // the whole library one generation behind what every current browser
    // accepts.
    //
    // The order is load-bearing: Next picks the FIRST configured format the
    // request's Accept header matches, so AVIF has to lead for AVIF-capable
    // browsers to get it, with WebP catching everyone else and the original
    // format catching the rest.
    //
    // What this is worth here specifically: 65 of the 104 published assets are
    // 1600x900 PNG editorial graphics — flat colour, hard edges, large areas of
    // one tone, which is the case AVIF compresses hardest. The trade is a
    // slower FIRST request per size/format pair (AVIF encode is roughly 50%
    // slower than WebP) and two cached derivatives per size instead of one.
    // Both are one-off costs against a static, rarely-changing library.
    formats: ["image/avif", "image/webp"],

    // The library's largest source is a 9.9 MB 4203x3152 PNG (the RTX 5090
    // photograph). The optimizer handles it correctly — it downscales to the
    // requested width and re-encodes, so no visitor ever receives 9.9 MB — but
    // the first request for each width/format pair pays that decode. A long
    // TTL is what keeps it a one-off: public storage paths are UUID-prefixed
    // and never rewritten in place, so a cached derivative can never go stale
    // against its source. 30 days rather than the 4-hour default.
    minimumCacheTTL: 60 * 60 * 24 * 30,

    // Required to be an explicit allowlist from Next 16 on. The site renders
    // every image at the default quality; 75 is that default, and pinning the
    // list to one value keeps the optimizer endpoint from being usable as a
    // generator of arbitrary re-encodes.
    qualities: [75],
  },
};

export default nextConfig;
