import type { Metadata } from "next";
import { buildNotFoundMetadata } from "@/lib/seo/metadata";
import { EntityNotFound } from "@/components/public/entity-not-found";

export const metadata: Metadata = buildNotFoundMetadata("/manufacturers");

export default function ManufacturerNotFound() {
  return <EntityNotFound entityLabel="Manufacturer" indexHref="/manufacturers" browseLabel="Browse manufacturers" />;
}
