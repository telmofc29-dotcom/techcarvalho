// Registers the canonical camera spec_definitions vocabulary
// (CAMERA_SPEC_DEFINITIONS, src/lib/catalogue/camera-specs.ts) with the
// ingestion batch. Every camera product file references these spec slugs
// but none of them declared the definitions themselves — without this
// file in the glob, `npx tsx scripts/ingest-catalogue.ts data/catalogue/*.ts`
// never creates the spec_definitions rows those references resolve
// against, and every product_specs row fails validation with
// "specSlug not found in DB or this batch". Filename is prefixed with an
// underscore so it sorts first alphabetically — spec definitions should
// exist before anything tries to reference them within the same batch.

import type { CatalogueImport } from "@/lib/catalogue/import-types";
import { CAMERA_SPEC_DEFINITIONS } from "@/lib/catalogue/camera-specs";

export const cameraSpecDefinitions: CatalogueImport = {
  specDefinitions: CAMERA_SPEC_DEFINITIONS,
};
