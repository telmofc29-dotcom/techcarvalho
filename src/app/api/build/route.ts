import { NextResponse } from "next/server";

// WHY THIS ENDPOINT EXISTS
//
// Twice now a push has reported success, `npm run build` has passed locally,
// `git ls-remote` has confirmed the commit on origin/main — and production has
// gone on serving the previous bundle. The first time (ecea6f4) a type-checked
// file imported an undeclared package, so Vercel's build failed while every
// local signal said fine. The second time the deploy simply had not landed 35
// minutes after the push.
//
// Both times the question "which commit is actually live?" turned out to be
// unanswerable from outside. The changes were admin-only and changed no label,
// so the rendered DOM was byte-identical between builds. Establishing which
// code was running took a signed-in headless browser and a write against the
// production database — for a question that should cost one HTTP request.
//
// So the build now tells you what it is:
//
//     curl -s https://www.techcarvalho.com/api/build
//
// Compare `commit` against `git rev-parse --short HEAD`. Equal means the deploy
// landed. Different means it did not, whatever the push said — no browser, no
// credentials, no writes.
//
// WHAT IT DELIBERATELY DOES NOT EXPOSE
// The short commit SHA, the branch, and the deployment id. Nothing about the
// environment, no secrets, no repository owner. A SHA alone grants no access to
// anything; being unable to tell what is deployed has already cost real time
// twice.

export const dynamic = "force-dynamic";

// Module scope in a serverless function is evaluated at COLD START, not at
// build time. So this is honestly named: it is when the instance serving you
// booted, which is a different fact from when the bundle was built. Calling it
// `builtAt` would be wrong in exactly the quiet way this endpoint exists to
// prevent. Use `commit` to identify the build; use this only to tell a warm
// instance from a fresh one.
const INSTANCE_STARTED_AT = new Date().toISOString();

export async function GET() {
  // Vercel injects these at build time; they are undefined locally, which is
  // why `commit` reads "local" rather than pretending to be a deployment.
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;

  return NextResponse.json(
    {
      commit: sha ? sha.slice(0, 7) : "local",
      commitFull: sha,
      ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      // Changes on every deploy even when the commit does not (a redeploy of
      // the same SHA), which distinguishes "rebuilt" from "never deployed".
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      instanceStartedAt: INSTANCE_STARTED_AT,
    },
    { headers: { "cache-control": "no-store, max-age=0" } }
  );
}
