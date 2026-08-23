import { SITE_NAME, SITE_URL, absoluteUrl } from "./site.ts";

// ---------------------------------------------------------------------------
// WHO PUBLISHES THIS SITE — one file, every consumer.
//
// Until this file existed, no human being was named anywhere on Tech Carvalho:
// not on /about, not in the footer, not on an article, not in the structured
// data (articleJsonLd emitted the Organization as author precisely because
// there was no readable person to name). Google's helpful-content guidance asks
// "is it self-evident to your visitors who authored your content?" and the
// honest answer was no.
//
// It is ONE file because the failure mode of publisher identity is drift: a
// name on /about, a different role in the footer, a third description in the
// JSON-LD, and a reviewer who now has three answers to one question. Every
// surface that names the publisher — /about, the site footer, the article
// byline, organizationJsonLd, the legal pages — reads from here.
//
// WHAT THIS FILE MUST NEVER CONTAIN
// ---------------------------------
// A biography, credentials, qualifications, years of experience, employment
// history, awards, or any claim of expertise. None of that is known to this
// codebase, and inventing it is precisely the failure this project exists not
// to commit. What is below is limited to: a name, a role, and statements about
// how the site operates that can be checked against the site itself.
// ---------------------------------------------------------------------------

/** The person responsible for what is published here. */
export const PUBLISHER_NAME = "Telmo Carvalho";

/** Their role. Not a job title from a CV — what they do on this site. */
export const PUBLISHER_ROLE = "Editor and publisher";

/**
 * Stable JSON-LD node id for the person, so the graph cross-references one
 * Person rather than restating them per document — same discipline as
 * ORGANIZATION_ID / WEBSITE_ID in jsonld.ts.
 */
export const PUBLISHER_PERSON_ID = `${SITE_URL}/#publisher`;

/** Where a reader goes to find out who is behind the site. */
export const PUBLISHER_PAGE = "/about";

/**
 * One factual sentence, used on /about and available to any other surface.
 *
 * Each clause is checkable:
 *  - "reviews and publishes every piece" — /editorial-policy states "Nothing is
 *    published automatically: a person reviews and publishes every piece", and
 *    publishing requires an admin_users row.
 *  - "does not publish hands-on testing" — evidence_records is empty site-wide
 *    and /editorial-policy says the same thing in its own words.
 */
export const PUBLISHER_ROLE_LINE =
  `${SITE_NAME} is edited and published by ${PUBLISHER_NAME}. Every piece on the site is reviewed and ` +
  `published by a person before it goes live, and he is responsible for what appears here. He does not ` +
  `publish hands-on testing — nothing on this site is written from having used the product.`;

/** The short form used where a full sentence does not fit (footer, byline). */
export const PUBLISHER_CREDIT = `Published by ${PUBLISHER_NAME}`;

/**
 * What this site does and does not do, in one place.
 *
 * These strings are quoted on the legal pages. They are kept here rather than
 * retyped per page for the same reason the name is: four slightly different
 * descriptions of the same practice is how a policy page ends up contradicting
 * an editorial policy page.
 *
 * Every one of them was verified against the codebase or the production
 * database on 2026-08-23 — see docs/adsense-readiness-audit.md for the method.
 */
export const EDITORIAL_PRACTICE = {
  /** evidence_records: 0 rows site-wide. content_items.type has zero 'review' rows. */
  noTesting:
    `${SITE_NAME} does not publish hands-on reviews, benchmarks, or test results. Articles are researched ` +
    `from manufacturer documentation, technical standards, and published reporting.`,

  /** product_offers: 0 rows. No affiliate link, and no retailer link, exists on the site today. */
  noAffiliate:
    `${SITE_NAME} has no affiliate relationships. No link on this site earns the publisher a commission.`,

  /**
   * There is no reader account system, no comment system and no submission
   * form anywhere in this codebase. The contact form is the single exception
   * and it is not published content — it writes to an admin-only table.
   */
  noUserContent:
    `The site has no reader accounts, no comments, and no user-submitted content. The contact form is the ` +
    `only way to send anything to ${SITE_NAME}, and what you send is never published.`,
} as const;

/** Absolute URL of the About page, for structured data. */
export function publisherPageUrl(): string {
  return absoluteUrl(PUBLISHER_PAGE);
}
