import type { Metadata } from "next";
import { buildNotFoundMetadata } from "@/lib/seo/metadata";
import { EntityNotFound } from "@/components/public/entity-not-found";

export const metadata: Metadata = buildNotFoundMetadata("/articles");

export default function ArticleNotFound() {
  return <EntityNotFound entityLabel="Article" indexHref="/articles" browseLabel="Browse articles" />;
}
