import type { Metadata } from "next";
import { buildNotFoundMetadata } from "@/lib/seo/metadata";
import { EntityNotFound } from "@/components/public/entity-not-found";

// There is no /families index route (a list of seven mostly-empty lines would
// be exactly the thin hub this pass exists to avoid), so a dead family slug
// self-canonicalizes to /products — the closest real page that owns the
// catalogue intent — rather than silently inheriting the root layout's "/".
export const metadata: Metadata = buildNotFoundMetadata("/products");

export default function FamilyNotFound() {
  return <EntityNotFound entityLabel="Product line" indexHref="/products" browseLabel="Browse products" />;
}
