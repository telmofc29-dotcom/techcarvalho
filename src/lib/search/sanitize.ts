// PostgREST's .or()/.ilike() filter strings treat comma, parens, and % as
// syntax — strip them from free-text search input before interpolating so a
// search term can't restructure the filter.
export function sanitizeSearchTerm(input: string): string {
  return input.replace(/[,()%]/g, "").trim();
}
