// Synthetic-traffic exclusion at ingestion time.
//
// WHY THIS EXISTS
// ---------------
// Verification runs against production wrote real analytics rows. By
// 2026-08-22 they were 43% of the entire dataset, and `/_rls-verify-test`
// alone had become the most-viewed page on the site — a path that never
// existed publicly. Cleaning it needed a manual SQL statement, because the
// analytics tables are deliberately admin-READ-only and the app's delete
// returned "0 rows deleted" with no error.
//
// The cleanup also demonstrated why pattern-matching after the fact is the
// wrong place to solve this: the patterns written from memory missed
// `/retest-no-select` and `/repro-full-shape`, which are still in the
// "clean" dataset. You cannot reliably enumerate names you have not thought
// of yet.
//
// So the fix is a CONVENTION enforced at write time, not a cleanup:
//
//   Any path beginning `/__test` is never recorded.
//
// Verification scripts and end-to-end runs must use that prefix. Nothing
// needs to remember to clean up afterwards, because nothing was written.
//
// The historical shapes are also matched, so a re-run of an old script
// cannot reintroduce the problem.

/**
 * The reserved prefix for synthetic traffic. Verification runs, Playwright
 * journeys and reproduction scripts must navigate paths under this prefix.
 *
 * It is a 404 on the public site, which is intentional: a test path should
 * not resolve to real content, because then it would be exercising the
 * wrong thing.
 */
export const TEST_PATH_PREFIX = "/__test";

// Shapes used by verification work before the convention existed. Kept so an
// old script cannot silently repopulate the table.
//
// `verify-` and friends are matched anywhere in the path rather than only at
// the start, because the historical paths were root-level single segments
// (`/verify-finaljourney-home-1787315742598`) that are indistinguishable from
// a category route by structure alone.
const LEGACY_SYNTHETIC = [
  /(^|\/)_?_?rls[-_]/i,
  /(^|\/)verify-/i,
  /(^|\/)retest-/i,
  /(^|\/)repro-/i,
  /(^|\/)e2e-/i,
  /(^|\/)smoke-/i,
  /(^|\/)playwright-/i,
];

// A trailing epoch-milliseconds stamp is a strong tell: real routes are
// human-authored slugs and never carry a 13-digit timestamp. This is what
// made the historical paths unique per run and therefore uncleanable in bulk.
const EPOCH_SUFFIX = /-\d{13}$/;

/**
 * Whether a path is synthetic and must not be recorded.
 *
 * Deliberately conservative in one direction only: it is far worse to record
 * fake traffic than to drop a genuine hit, because fake traffic silently
 * corrupts every conclusion drawn from the table afterwards, while a dropped
 * hit is merely one missing row.
 */
export function isSyntheticPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const p = path.trim();
  if (!p) return false;

  if (p === TEST_PATH_PREFIX || p.startsWith(`${TEST_PATH_PREFIX}/`) || p.startsWith(`${TEST_PATH_PREFIX}-`)) {
    return true;
  }
  if (EPOCH_SUFFIX.test(p)) return true;
  return LEGACY_SYNTHETIC.some((re) => re.test(p));
}

/**
 * Whether a hostname should be recorded at all.
 *
 * Local development and preview deployments share the production database in
 * this project (there is one Supabase instance), so a developer clicking
 * around localhost would otherwise land in production analytics.
 */
export function isSyntheticHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return (
    h.startsWith("localhost") ||
    h.startsWith("127.0.0.1") ||
    h.startsWith("0.0.0.0") ||
    h.startsWith("[::1]") ||
    h.endsWith(".local") ||
    // Vercel preview deployments: *.vercel.app that is not the production
    // domain. Preview traffic is our own, not a reader's.
    h.endsWith(".vercel.app")
  );
}
