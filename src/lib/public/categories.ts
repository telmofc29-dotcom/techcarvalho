// The site's planned initial subject areas. These are a curated navigation
// list, not a substitute for the taxonomy_categories table — each entry only
// renders real content once an admin creates a matching category (by slug)
// and publishes products/content under it. Until then the category page
// shows an honest "coming soon" state rather than fabricated content.
export type PlannedCategory = {
  slug: string;
  label: string;
  blurb: string;
};

export const PLANNED_CATEGORIES: PlannedCategory[] = [
  { slug: "cameras-photography", label: "Cameras & Photography", blurb: "Cameras, lenses, and the gear behind them." },
  { slug: "camera-lenses", label: "Camera Lenses", blurb: "Lenses across every mount, and what actually changes between them." },
  { slug: "astrophotography", label: "Astrophotography", blurb: "Imaging the night sky, from mounts to stacking." },
  { slug: "drones-fpv", label: "Drones & FPV", blurb: "Aerial platforms, FPV builds, and flight gear." },
  { slug: "action-cameras", label: "Action Cameras", blurb: "Rugged cameras built for motion and the outdoors." },
  { slug: "computing", label: "Computing", blurb: "PCs, components, and the software that runs on them." },
  { slug: "networking", label: "Networking", blurb: "Routers, mesh systems, and home network infrastructure." },
  { slug: "gaming", label: "Gaming", blurb: "Hardware and peripherals for playing games." },
  { slug: "smartphones", label: "Smartphones", blurb: "Phones, from flagships to the upgrade question." },
  { slug: "ai-hardware", label: "AI & AI Hardware", blurb: "AI features, on-device AI, and the hardware behind them." },
  { slug: "smart-home-robots", label: "Smart Home & Robots", blurb: "Robot vacuums, smart displays, and connected home gear." },
  { slug: "3d-printing", label: "3D Printing", blurb: "Printers, materials, and what the specifications actually mean." },
];

export function findPlannedCategory(slug: string): PlannedCategory | undefined {
  return PLANNED_CATEGORIES.find((c) => c.slug === slug);
}
