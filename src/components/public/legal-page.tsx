import Link from "next/link";
import { Breadcrumbs } from "./breadcrumbs";
import { SITE_NAME } from "@/lib/seo/site";

const OTHER_POLICIES = [
  { href: "/privacy", label: "Privacy" },
  { href: "/cookies", label: "Cookies" },
  { href: "/terms", label: "Terms" },
  { href: "/affiliate-disclosure", label: "Affiliate Disclosure" },
  { href: "/editorial-policy", label: "Editorial Policy" },
];

export function LegalPage({
  title,
  crumbLabel,
  crumbPath,
  children,
  provisional = true,
}: {
  title: string;
  crumbLabel: string;
  crumbPath: string;
  children: React.ReactNode;
  /**
   * Whether this page is still a placeholder. Defaults to TRUE so the
   * conservative reading survives: a policy page is provisional until somebody
   * deliberately declares it finished.
   */
  provisional?: boolean;
}) {
  const otherLinks = OTHER_POLICIES.filter((p) => p.href !== crumbPath);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: crumbLabel, path: crumbPath }]} />
      <h1 className="font-display text-2xl font-bold text-zinc-900 mb-6">{title}</h1>
      <div className="prose text-sm text-zinc-700 flex flex-col gap-4">{children}</div>
      {/* PER PAGE, not unconditional.
          This banner rendered on all five legal pages with no way to switch it
          off, so a page that genuinely describes how the site operates still
          told every reader it was a placeholder. Two costs: it is untrue of a
          finished page, and Google's Publisher Policies bar ads on screens
          "under construction" — the site was saying that about itself, on its
          own privacy policy.
          It defaults to TRUE so the conservative reading survives: a page is
          provisional until somebody deliberately says otherwise. */}
      {provisional && (
        <p className="text-xs text-zinc-400 mt-10">
          This page is a placeholder pending final legal review and does not yet constitute{" "}
          {SITE_NAME}&apos;s complete policy.
        </p>
      )}
      <nav aria-label="Other policies" className="mt-8 pt-6 border-t border-border-subtle">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Related policies</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {otherLinks.map((p) => (
            <li key={p.href}>
              <Link href={p.href} className="text-sm text-accent hover:underline">
                {p.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
