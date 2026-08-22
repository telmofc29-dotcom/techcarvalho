import type { HeroImage } from "@/lib/public/hero-image";
import { classifiable } from "@/lib/public/hero-image";
import { isDataGraphic } from "@/lib/media/presentation";
import { LeadMediaFrame } from "./lead-media-frame";
import { MediaCredit } from "./media-credit";

// The article page's lead image, brought up to the standard the PRODUCT page
// already met.
//
// What this replaces was four lines inline on the page: a bare `aspect-video`
// + `object-cover` <Image> with no `sizes`, no caption, no credit and no
// label. Three consequences, all real:
//
//  1. LICENCE. Article heroes include CC BY and CC BY-SA photographs from
//     Wikimedia Commons. Both licences require the creator's name, a link to
//     the licence deed and a link to the material. The product page has
//     rendered all three since MediaCredit was written; the article page
//     rendered none of them, so those photographs were published with no
//     attribution at all.
//  2. SOURCING. Editorial charts and timelines carry a caption naming what the
//     graphic shows and the source it was built from ("Source: Publisher store
//     listings on Steam, as of ..."). The column existed and was populated;
//     the page never read it, so a sourced graphic appeared as an unsourced
//     picture.
//  3. CROPPING. `object-cover` centre-cropped comparison tables and timelines,
//     which carry information at their edges. See LeadMediaFrame.
//
// The "Graphic" chip is the same honesty device the product page uses, applied
// where it is load-bearing: an informational graphic, or anything flagged
// ai_generated. A category title card gets no chip — it makes no claim to
// depict anything, and its alt text already says what it is.

const ARTICLE_LEAD_SIZES = "(min-width: 768px) 720px, calc(100vw - 48px)";

export function ArticleLeadMedia({ heroImage }: { heroImage: HeroImage }) {
  const asset = classifiable(heroImage);
  const labelAsGraphic = isDataGraphic(asset) || heroImage.aiGenerated === true;

  return (
    <figure className="mb-8">
      <LeadMediaFrame
        image={heroImage}
        // No fallback to the article title: the <h1> immediately above already
        // says it, and repeating it here makes a screen reader announce the
        // same sentence twice while describing nothing about the image. An
        // image we cannot describe is decorative, and empty alt is how that is
        // spelled.
        alt={heroImage.alt ?? ""}
        sizes={ARTICLE_LEAD_SIZES}
        preload
      />
      {(labelAsGraphic || heroImage.caption) && (
        <figcaption className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs leading-relaxed text-zinc-500">
          {labelAsGraphic && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-accent-soft px-2 py-0.5 font-medium text-zinc-700">
              Graphic
            </span>
          )}
          {heroImage.caption && <span>{heroImage.caption}</span>}
        </figcaption>
      )}
      {heroImage.attributionRequired && (
        <MediaCredit
          attribution={heroImage.attribution ?? null}
          creator={heroImage.creator}
          license={heroImage.license}
          sourceUrl={heroImage.sourceUrl}
          className="mt-1 text-xs text-zinc-500"
        />
      )}
    </figure>
  );
}
