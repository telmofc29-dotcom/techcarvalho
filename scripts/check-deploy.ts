/**
 * Is production serving the commit I just pushed?
 *
 *   npx tsx scripts/check-deploy.ts
 *
 * Reads /api/build (see src/app/api/build/route.ts for why that exists) and
 * compares it to local HEAD. No credentials, no browser, no writes.
 *
 * Exit code 0 = live, 1 = not live / unreachable, so it can gate a script.
 */
import { execSync } from "node:child_process";

const BASE = process.env.TC_BASE_URL ?? "https://www.techcarvalho.com";

const head = execSync("git rev-parse --short HEAD").toString().trim();
const pushed = execSync("git rev-parse --short origin/main").toString().trim();

const res = await fetch(`${BASE}/api/build`, { cache: "no-store" });

if (!res.ok) {
  console.log(`GET ${BASE}/api/build -> ${res.status}`);
  console.log(
    res.status === 404
      ? "NOT LIVE: the endpoint itself is missing, so production predates it."
      : "Could not read the build stamp."
  );
  process.exit(1);
}

const b = (await res.json()) as {
  commit: string;
  ref: string | null;
  deploymentId: string | null;
  instanceStartedAt: string;
};

console.log(`local HEAD   ${head}`);
console.log(`origin/main  ${pushed}`);
console.log(`production   ${b.commit}${b.ref ? ` (${b.ref})` : ""}`);
console.log(`deployment   ${b.deploymentId ?? "—"}`);

if (head !== pushed) {
  console.log("\nNote: local HEAD is not what is on origin/main. Push first.");
}

if (b.commit === pushed) {
  console.log("\nLIVE — production is serving the pushed commit.");
  process.exit(0);
}

console.log("\nNOT LIVE — production is serving a different commit.");
console.log("The push succeeding is not the same as the deploy landing.");
console.log("Check the Vercel dashboard for a failed or queued build.");
process.exit(1);
