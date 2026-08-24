// Capture the REAL exception behind a production "Minified React error #441".
//
// THE PROBLEM THIS SOLVES
// ----------------------
// When a Server Component throws in a production build, React replaces the
// message with:
//
//   "An error occurred in the Server Components render. The specific message is
//    omitted in production builds to avoid leaking sensitive details. A digest
//    property is included on this error instance which may provide additional
//    details about the nature of the error."
//
// That is React error #441, and it is deliberately useless on its own. The
// admin sees a masked message; the actual TypeError, its stack, and the line
// that threw exist only server-side and, until now, were never written anywhere
// we could read them. Two sessions disagreed about whether /admin/media/new
// worked and there was no way to find out why, because the only artefact was a
// number that means "something threw".
//
// `onRequestError` is Next's supported hook for exactly this. It fires whenever
// the server captures a request error and receives the error, the request, and
// the render context. Next's own documentation notes that the error instance
// "might not be the original error instance thrown, as it may be processed by
// React if encountered during Server Components rendering. If this happens, you
// can use `digest` property on an error to identify the actual error type."
//
// So this logs BOTH: whatever message survived, and the digest — which is the
// same digest the browser is shown. That is the correlation key. An admin can
// read a digest off the error screen and it can be found in the Vercel log.
//
// Output goes to stdout/stderr, which is where Vercel's function logs come
// from. No external service, no dependency, nothing to configure or pay for.

import type { Instrumentation } from "next";

import { formatBuildInfo } from "@/lib/build-info";
import { recordError } from "@/lib/log/recent-errors";

/**
 * Structured, single-line-per-error report for a captured server error.
 *
 * Written as one line with a stable `[request-error]` prefix so it can be
 * grepped in the Vercel log viewer, with the stack appended afterwards because
 * a stack is the part actually worth reading.
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  const error = err as { name?: string; message?: string; stack?: string; digest?: string; code?: string };

  const digest = typeof error?.digest === "string" ? error.digest : "none";
  const name = error?.name ?? typeof err;
  const message = error?.message ?? String(err);

  // The header is everything needed to correlate a browser report with this
  // line: the digest the user can read off the screen, the path they visited,
  // and the build that served it.
  console.error(
    `[request-error] digest=${digest} path=${request?.path ?? "?"} method=${request?.method ?? "?"} ` +
      `routePath=${context?.routePath ?? "?"} routeType=${context?.routeType ?? "?"} ` +
      `renderSource=${context?.renderSource ?? "?"} name=${name} code=${error?.code ?? "none"} ` +
      `build=[${formatBuildInfo()}] message=${JSON.stringify(message)}`
  );

  if (error?.stack) {
    console.error(`[request-error] digest=${digest} stack:\n${error.stack}`);
  }

  // A Supabase/PostgREST error carries its detail on sibling properties rather
  // than in `message`, and losing them turns a precise database fault into a
  // vague one. Printed only when present.
  const pg = err as { details?: unknown; hint?: unknown };
  if (pg?.details || pg?.hint) {
    console.error(
      `[request-error] digest=${digest} details=${JSON.stringify(pg.details ?? null)} hint=${JSON.stringify(pg.hint ?? null)}`
    );
  }

  // Also keep it in memory so an admin can read the exception back through the
  // browser. Whoever is debugging may not have platform log access — that was
  // the exact situation this hook was built for and could not resolve.
  // Best-effort by definition: see the caveat in recent-errors.ts.
  try {
    recordError({
      digest,
      at: new Date().toISOString(),
      path: request?.path ?? "?",
      method: request?.method ?? "?",
      routePath: context?.routePath ?? "?",
      routeType: context?.routeType ?? "?",
      renderSource: context?.renderSource ?? "?",
      name: String(name),
      message,
      stack: error?.stack ?? null,
      details: pg?.details == null ? null : String(pg.details),
      hint: pg?.hint == null ? null : String(pg.hint),
      code: error?.code ?? null,
    });
  } catch {
    // Never let diagnostics break the error path itself.
  }
};
