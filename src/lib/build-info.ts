// Which build is actually serving this request.
//
// WHY THIS EXISTS
// ---------------
// /admin/media/new was reported broken in production while every automated
// probe against the same URL, with the same admin account, returned a healthy
// page. Two sessions were being told different things and there was no way to
// establish whether they were even talking to the same deployment — the only
// evidence available was `git log` and `origin/main`, neither of which is a
// statement about what Vercel is serving.
//
// Vercel injects these at build/run time. Reading them here gives a browser
// request an identity it can be correlated with: the commit, the deployment,
// and the region that produced the response in front of you.
//
// SAFETY
// ------
// Everything here is non-secret: a public commit SHA, a deployment id, a region
// code, and the environment name. There is no token, connection string, or
// account data. It is still only rendered inside authenticated admin surfaces,
// because a build identifier is operational detail a visitor has no use for.

export type BuildInfo = {
  /** Full git SHA of the deployed commit, when the platform provides one. */
  commit: string | null;
  /** First 7 characters of the commit, for display. */
  shortCommit: string | null;
  /** Vercel's deployment identifier, unique per deployment. */
  deploymentId: string | null;
  /** The region that executed this request. */
  region: string | null;
  /** "production" | "preview" | "development", per Vercel. */
  environment: string | null;
};

/**
 * Read the deployment identity from the environment.
 *
 * Every field degrades to null rather than throwing or inventing a value: this
 * runs locally too, where none of these variables exist, and a build identifier
 * that guesses is worse than one that admits it does not know.
 */
export function getBuildInfo(): BuildInfo {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  return {
    commit,
    shortCommit: commit ? commit.slice(0, 7) : null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    region: process.env.VERCEL_REGION ?? null,
    environment: process.env.VERCEL_ENV ?? null,
  };
}

/** One-line form for logs and for the admin error boundary. */
export function formatBuildInfo(info: BuildInfo = getBuildInfo()): string {
  const parts = [
    info.shortCommit ? `commit ${info.shortCommit}` : "commit unknown",
    info.environment ? `env ${info.environment}` : null,
    info.region ? `region ${info.region}` : null,
    info.deploymentId ? `deployment ${info.deploymentId}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}
