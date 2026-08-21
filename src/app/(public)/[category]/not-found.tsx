import type { Metadata } from "next";
import { buildNotFoundMetadata } from "@/lib/seo/metadata";
import { EntityNotFound } from "@/components/public/entity-not-found";

export const metadata: Metadata = buildNotFoundMetadata("/");

export default function CategoryNotFound() {
  return <EntityNotFound entityLabel="Category" indexHref="/" browseLabel="Back to homepage" />;
}
