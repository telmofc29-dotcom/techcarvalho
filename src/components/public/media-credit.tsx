import { licenceUrl, sourceLabel } from "@/lib/media/licence-links";
import { TOUCH_INLINE } from "@/components/shared/ui";

// These two links are a licence CONDITION (see below), so they have to be
// genuinely tappable, not merely present. At text-xs they were 16px tall.
// They sit inside a caption sentence, so the hit area is grown with a
// ::before overlay rather than by padding the visible box, which would push
// the caption's lines apart. The enclosing span is whitespace-nowrap, so
// neither link wraps and its overlay stays a single clean rectangle.
const CREDIT_LINK = `${TOUCH_INLINE} underline decoration-dotted underline-offset-2 hover:text-zinc-700`;

// A CC BY / CC BY-SA credit is a licence CONDITION, not decoration.
//
// Both licences require the reuser to give the creator's name, "provide a link
// to the license", and provide "a link to the material". Rendering the credit
// as plain text satisfies only the first of those three. With twelve
// Commons-sourced photographs live on product pages, that gap applied to every
// one of them.
//
// Deliberately renders whatever it can rather than all-or-nothing: a missing
// source URL should still leave the creator's name showing, because a partial
// credit is closer to compliant than none.
export function MediaCredit({
  attribution,
  creator,
  license,
  sourceUrl,
  className = "mt-2 text-xs text-zinc-500",
}: {
  attribution: string | null;
  creator?: string | null;
  license?: string | null;
  sourceUrl?: string | null;
  className?: string;
}) {
  const deed = licenceUrl(license);
  const source = sourceLabel(sourceUrl);

  // The stored attribution string is the human-verified wording and stays the
  // authoritative text. Links are added ALONGSIDE it rather than by parsing
  // and rewriting it — rewriting a legal credit line to inject markup risks
  // changing what it says.
  const hasLinks = Boolean(deed || (sourceUrl && source));
  if (!attribution && !creator && !hasLinks) return null;

  return (
    <figcaption className={className}>
      <span>{attribution ?? creator}</span>
      {hasLinks && (
        <>
          {" "}
          <span className="whitespace-nowrap">
            {deed && license && (
              <a
                href={deed}
                rel="license noopener noreferrer"
                target="_blank"
                className={CREDIT_LINK}
              >
                {license}
              </a>
            )}
            {deed && sourceUrl && source && <span aria-hidden="true"> · </span>}
            {sourceUrl && source && (
              <a
                href={sourceUrl}
                rel="noopener noreferrer"
                target="_blank"
                className={CREDIT_LINK}
              >
                {source}
              </a>
            )}
          </span>
        </>
      )}
    </figcaption>
  );
}
