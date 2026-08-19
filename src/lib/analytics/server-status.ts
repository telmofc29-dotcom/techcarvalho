import "server-only";

export function isAnalyticsConfiguredServer(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID);
}
