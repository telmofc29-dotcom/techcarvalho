import Image from "next/image";
import type { HeroImage } from "@/lib/public/hero-image";
import { classifyProductMedia } from "@/lib/media/presentation";

// The lead (hero) slot on a product page, rendered honestly in all three
// states — see src/lib/media/presentation.ts for the reasoning.
//
// Why this is a component rather than three inline branches on the page: the
// "no photograph" state is the DEFAULT for most of the catalogue, not a rare
// edge case. Most products TechCarvalho covers have no photograph the site
// holds clear rights to, and the honest answer to that is a designed panel
// that says so — not an empty div that reads as a broken image.

function NoPhotoPanel({ productName }: { productName: string }) {
  return (
    <figure className="mb-6">
      <div className="w-full rounded-xl border border-dashed border-border-subtle bg-zinc-50 px-6 py-10 text-center">
        <p className="font-display text-sm font-semibold uppercase tracking-wider text-zinc-500">
          No photograph available
        </p>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-zinc-600">
          We don&apos;t have a photograph of the {productName} that we hold clear publication
          rights to. Rather than show a stand-in that could be mistaken for one, we&apos;ve left
          this space empty and put the verified specifications below.
        </p>
        <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-zinc-400">
          We never generate or synthesise product imagery.
        </p>
      </div>
    </figure>
  );
}

export function ProductLeadMedia({
  heroImage,
  productName,
}: {
  heroImage: HeroImage | null;
  productName: string;
}) {
  const presentation = classifyProductMedia(
    heroImage
      ? {
          source_type: heroImage.sourceType,
          owned: heroImage.owned,
          ai_generated: heroImage.aiGenerated,
          attribution_required: heroImage.attributionRequired,
          attribution: heroImage.attribution,
          creator: heroImage.creator,
        }
      : null
  );

  if (presentation.kind === "none" || !heroImage) {
    return <NoPhotoPanel productName={productName} />;
  }

  if (presentation.kind === "original_graphic") {
    return (
      <figure className="mb-6">
        <div className="relative w-full aspect-video overflow-hidden rounded-xl bg-zinc-100">
          <Image
            src={heroImage.url}
            alt={heroImage.alt ?? `Original TechCarvalho graphic for the ${productName}`}
            fill
            priority
            // `contain`, not `cover`: a spec table or comparison chart carries
            // information at its edges. Cropping it to fill the frame would
            // cut off the very content that justifies showing it.
            className="object-contain"
          />
        </div>
        {/* Deliberately above the fold of the caption stack and not muted into
            invisibility — this label is the thing that keeps the graphic
            honest, so it has to actually be readable. */}
        <figcaption className="mt-2 flex items-center gap-2 text-xs text-zinc-500">
          <span className="inline-flex shrink-0 items-center rounded-full bg-accent-soft px-2 py-0.5 font-medium text-zinc-700">
            Graphic
          </span>
          <span>{presentation.label}</span>
        </figcaption>
      </figure>
    );
  }

  return (
    <figure className="mb-6">
      <div className="relative w-full aspect-video overflow-hidden rounded-xl bg-zinc-100">
        <Image
          src={heroImage.url}
          alt={heroImage.alt ?? productName}
          fill
          priority
          className="object-cover"
        />
      </div>
      {presentation.attribution && (
        // A CC BY / CC BY-SA credit is a licence CONDITION, not decoration.
        // If this line does not render, the site is out of compliance with
        // the licence it is relying on.
        <figcaption className="mt-2 text-xs text-zinc-400">{presentation.attribution}</figcaption>
      )}
    </figure>
  );
}
