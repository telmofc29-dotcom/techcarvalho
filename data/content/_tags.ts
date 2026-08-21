// Registers every taxonomy_tags row the content batch references by slug.
// taxonomy_tags was empty in production before this file — every
// `tagSlugs` entry across data/content/*.ts needs a matching definition
// here (or to already exist from a prior batch) or the ingestion script
// fails that content item's tag pass. Filename prefixed with an
// underscore so it sorts first alphabetically, same reasoning as
// data/catalogue/_spec-definitions.ts. Display names are presentation
// copy for a slug that's already semantically fixed by real content usage
// — not a factual claim, so this isn't subject to the "never fabricate"
// sourcing rule that applies to product specs/dates/claims.

import type { ContentBatchImport } from "@/lib/content/import-types";

export const contentTags: ContentBatchImport = {
  content: [],
  tagDefinitions: [
    { slug: "ai", name: "AI" },
    { slug: "astrophotography", name: "Astrophotography" },
    { slug: "beginner-guide", name: "Beginner Guide" },
    { slug: "buying-guide", name: "Buying Guide" },
    { slug: "camera-settings", name: "Camera Settings" },
    { slug: "canon", name: "Canon" },
    { slug: "comparison", name: "Comparison" },
    { slug: "consumer-hardware", name: "Consumer Hardware" },
    { slug: "dslr", name: "DSLR" },
    { slug: "equatorial-mount", name: "Equatorial Mount" },
    { slug: "equipment", name: "Equipment" },
    { slug: "gaming", name: "Gaming" },
    { slug: "gpu", name: "GPU" },
    { slug: "gta-6", name: "GTA 6" },
    { slug: "lenses", name: "Lenses" },
    { slug: "mesh-wifi", name: "Mesh Wi-Fi" },
    { slug: "meteor-photography", name: "Meteor Photography" },
    { slug: "mirrorless", name: "Mirrorless" },
    { slug: "moon-photography", name: "Moon Photography" },
    { slug: "networking", name: "Networking" },
    { slug: "new-camera", name: "New Camera" },
    { slug: "nvidia", name: "Nvidia" },
    { slug: "old-vs-new", name: "Old vs New" },
    { slug: "openai", name: "OpenAI" },
    { slug: "pc-hardware", name: "PC Hardware" },
    { slug: "playstation", name: "PlayStation" },
    { slug: "robotics", name: "Robotics" },
    { slug: "rockstar", name: "Rockstar Games" },
    { slug: "rumours", name: "Rumours" },
    { slug: "sensor-size", name: "Sensor Size" },
    { slug: "smart-home", name: "Smart Home" },
    { slug: "solar-photography", name: "Solar Photography" },
    { slug: "troubleshooting", name: "Troubleshooting" },
    { slug: "used-gear", name: "Used Gear" },
    { slug: "video", name: "Video" },
    { slug: "wide-field", name: "Wide-Field Astrophotography" },
    { slug: "wifi", name: "Wi-Fi" },
    { slug: "xbox", name: "Xbox" },
  ],
};
