import type { Metadata } from "next";
import { buildNotFoundMetadata } from "@/lib/seo/metadata";
import { EntityNotFound } from "@/components/public/entity-not-found";

export const metadata: Metadata = buildNotFoundMetadata("/products");

export default function ProductNotFound() {
  return <EntityNotFound entityLabel="Product" indexHref="/products" browseLabel="Browse products" />;
}
