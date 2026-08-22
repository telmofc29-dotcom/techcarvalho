-- ============================================================================
-- Forbid reciprocal product_relationships rows — NOT YET APPLIED
-- ============================================================================
-- Drafted, not run. Lives in migrations_pending/ so no tooling picks it up;
-- move it into migrations/ only once it has actually been executed.
--
-- WHAT THIS FIXES
-- ---------------
-- product_relationships is stored ONE-DIRECTIONAL by design. The reverse is
-- inferred at query time: src/lib/public/product-detail.ts queries both
-- product_id = X and related_product_id = X and labels each direction
-- differently. CLAUDE.md states the rule explicitly — "never insert the
-- reciprocal row manually".
--
-- Nothing enforced it. On 2026-08-22 the table contained:
--
--   canon-eos-r7  -alternative_to->  canon-eos-r10
--   canon-eos-r10 -alternative_to->  canon-eos-r7
--
-- Both rows were created 2026-08-20. Because the query infers the reverse,
-- /products/canon-eos-r7 rendered "Canon EOS R10" TWICE, both labelled
-- "Alternative". The duplicate row has since been deleted by hand and the
-- live page verified, but the table would accept another one tomorrow.
--
-- HOW IT WORKS
-- ------------
-- A unique index on the UNORDERED pair. least()/greatest() normalise the two
-- uuids into a canonical order, so (A,B) and (B,A) collide on the same index
-- entry regardless of which way round they were inserted.
--
-- Scoped to relationship_type on purpose: two products may legitimately hold
-- more than one KIND of relationship (a successor can also be an
-- alternative), and this must not prevent that. It only prevents the same
-- relationship being asserted twice in opposite directions.
--
-- Forbidding the reciprocal is correct for both shapes this table holds:
--   * asymmetric types (successor_of) — A successor_of B AND B successor_of A
--     is a contradiction, not a duplicate;
--   * symmetric types (alternative_to, compatible_with) — the reverse is
--     already inferred, so storing it is pure duplication.
--
-- BEFORE APPLYING: this will fail if any reciprocal pair still exists. Check
-- first, and delete one row of each pair:
--
--   select least(product_id, related_product_id)    as a,
--          greatest(product_id, related_product_id) as b,
--          relationship_type,
--          count(*), array_agg(id)
--     from public.product_relationships
--    group by 1, 2, 3
--   having count(*) > 1;
--
-- As of 2026-08-22 that query returns zero rows.

create unique index if not exists product_relationships_unordered_pair_idx
  on public.product_relationships (
    least(product_id, related_product_id),
    greatest(product_id, related_product_id),
    relationship_type
  );

comment on index public.product_relationships_unordered_pair_idx is
  'Enforces the one-directional storage rule. The reverse direction is inferred at query time by product-detail.ts, so a reciprocal row renders the same relationship twice.';
