import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        // The admin CMS. Also noindex'd at src/app/admin/layout.tsx, and
        // redirect-protected by src/proxy.ts — this is the crawl-budget
        // layer of that, not the security layer.
        "/admin",
        // Analytics ingest, the growth-engine cron endpoints and the auth
        // confirmation handler. None of these render a page; crawling them
        // spends budget on routes that can only ever return JSON or a
        // redirect, and /api/analytics/track in particular would record
        // crawler traffic as pageviews.
        "/api/",
        "/auth/",
      ],
    },
    // Deliberately NOT disallowing /search. It is already noindex at the page
    // level, and a crawler has to be allowed to fetch a page in order to see
    // its noindex — blocking it here would leave any /search URL that picked
    // up an inbound link eligible to be indexed URL-only, which is the exact
    // outcome the noindex exists to prevent.
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
