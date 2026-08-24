// A small in-memory record of recently captured server errors, readable by an
// authenticated admin.
//
// WHY THIS EXISTS
// ---------------
// src/instrumentation.ts writes the real exception behind every masked React
// #441 to stdout, which reaches the platform's function logs. That works, but it
// assumes whoever is debugging can read those logs. During this investigation
// the person who could reproduce the failure had log access and the person
// diagnosing it did not, so a digest displayed on screen still could not be
// resolved to an exception — the information existed and was unreachable.
//
// This closes that gap without adding a dependency, a migration, or a schema
// change: the same handler that logs the error also keeps the last few in
// memory, and an admin-only endpoint reads them back by digest.
//
// HONEST LIMITATION
// -----------------
// This is per-instance memory on a serverless platform. The request that failed
// and the request that reads this endpoint may land on different instances, and
// instances are recycled freely. So a hit here is conclusive and a miss proves
// nothing — the platform log remains the authoritative source. Reproducing the
// failure and reading this endpoint immediately afterwards gives the best
// chance of landing on the same warm instance.
//
// NOT A REPLACEMENT for logging: instrumentation.ts still logs everything.

export type RecordedError = {
  /** The digest shown on the admin error screen. The correlation key. */
  digest: string;
  at: string;
  path: string;
  method: string;
  routePath: string;
  routeType: string;
  renderSource: string;
  name: string;
  message: string;
  stack: string | null;
  /** PostgREST puts the useful part of a database failure here, not in message. */
  details: string | null;
  hint: string | null;
  code: string | null;
};

const MAX_ENTRIES = 25;

// Held on globalThis so the buffer survives module re-evaluation within the
// same instance (different bundles can otherwise get separate module scopes).
const KEY = "__tc_recent_errors__";

type Store = { entries: RecordedError[] };

function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  let s = g[KEY];
  if (!s) {
    s = { entries: [] };
    g[KEY] = s;
  }
  return s;
}

/** Record one captured error, newest first, bounded. */
export function recordError(entry: RecordedError): void {
  const s = store();
  s.entries.unshift(entry);
  if (s.entries.length > MAX_ENTRIES) s.entries.length = MAX_ENTRIES;
}

/** Read back what this instance has seen, newest first. */
export function recentErrors(): RecordedError[] {
  return store().entries.slice();
}

/** Find one by the digest an admin read off the error screen. */
export function findByDigest(digest: string): RecordedError | null {
  return store().entries.find((e) => e.digest === digest) ?? null;
}
