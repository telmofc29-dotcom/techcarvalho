import { licenceUrl, sourceLabel } from "@/lib/media/licence-links";

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
                className="underline decoration-dotted underline-offset-2 hover:text-zinc-700"
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
                className="underline decoration-dotted underline-offset-2 hover:text-zinc-700"
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
