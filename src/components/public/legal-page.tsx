import { Breadcrumbs } from "./breadcrumbs";
import { SITE_NAME } from "@/lib/seo/site";

export function LegalPage({
  title,
  crumbLabel,
  crumbPath,
  children,
}: {
  title: string;
  crumbLabel: string;
  crumbPath: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: crumbLabel, path: crumbPath }]} />
      <h1 className="text-2xl font-semibold text-neutral-900 mb-6">{title}</h1>
      <div className="prose prose-neutral text-sm text-neutral-700 flex flex-col gap-4">{children}</div>
      <p className="text-xs text-neutral-400 mt-10">
        This page is a placeholder pending final legal review and does not yet constitute {SITE_NAME}&apos;s
        complete policy.
      </p>
    </div>
  );
}
