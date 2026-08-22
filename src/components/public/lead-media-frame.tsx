import Image from "next/image";
import { dimensionsUnknown, frameAspectRatio, mediaFit } from "@/lib/media/presentation";
import type { HeroImage } from "@/lib/public/hero-image";
import { classifiable } from "@/lib/public/hero-image";

// The frame a LEAD (hero) image is rendered in, shared by product and article
// pages so the two cannot drift apart again.
//
// WHY THE FRAME IS BUILT AROUND THE IMAGE
// ---------------------------------------
// Both pages used to hardcode `aspect-video` + `object-cover`. That is a
// centre crop of whatever it is handed, and the library is not 16:9:
// alongside the 1600x900 editorial graphics there are 3:2 and 4:3 Commons
// photographs and a handful of 3:4 portrait phone shots. A 3:4 photograph
// centre-cropped into a 16:9 box keeps about 30% of the image — the middle
// band of the phone, with the top and bottom of the device gone.
//
// So the frame takes its aspect ratio from the asset's own recorded
// width/height (clamped between 1:1 and 16:9 so a panorama or a very tall
// portrait cannot distort the page). When the frame matches the image,
// `cover` and `contain` do the same thing and NOTHING is cropped. Only the
// genuine outliers get clamped, and they crop by the minimum needed.
//
// Because the ratio is emitted at render time from data the server already
// has, there is no layout shift: the box reserves its exact height before the
// image arrives.
//
// `fit` still matters for the clamped cases and for anything with no recorded
// dimensions: a chart falls back to being contained on a neutral ground
// rather than trimmed, a photograph falls back to filling the frame.

export function LeadMediaFrame({
  image,
  alt,
  sizes,
  preload = false,
  className = "",
}: {
  image: HeroImage;
  alt: string;
  /** Real rendered width per breakpoint. See the note on MediaFrame's `sizes`. */
  sizes: string;
  /** At most one image per page. Replaces the deprecated `priority` prop. */
  preload?: boolean;
  className?: string;
}) {
  const asset = classifiable(image);
  // An asset with no recorded dimensions is contained regardless of what it
  // is. Cropping asserts the edges are expendable, and the frame it would be
  // cropped into is itself only a guess when the shape is unknown.
  const contained = mediaFit(asset) === "contain" || dimensionsUnknown(image.width, image.height);

  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl ${
        contained ? "bg-zinc-50" : "bg-zinc-100"
      } ${className}`}
      style={{ aspectRatio: frameAspectRatio(image.width, image.height) }}
    >
      <Image
        src={image.url}
        alt={alt}
        fill
        sizes={sizes}
        preload={preload}
        className={contained ? "object-contain" : "object-cover"}
      />
    </div>
  );
}
