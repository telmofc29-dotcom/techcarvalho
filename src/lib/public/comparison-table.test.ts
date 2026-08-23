import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildComparisonTable,
  isComparisonWorthRendering,
  MIN_PRODUCTS_WITH_VALUE,
  MAX_ROWS,
  type ComparisonDefinition,
} from "./comparison-table.ts";

const R5 = { id: "p1", name: "Canon EOS R5", slug: "canon-eos-r5" };
const R6 = { id: "p2", name: "Canon EOS R6", slug: "canon-eos-r6" };

const defs = (over: Partial<ComparisonDefinition>[] = []): ComparisonDefinition[] => [
  { id: "d1", name: "Sensor resolution", unit: "MP", dataType: "number" },
  { id: "d2", name: "Lens mount", unit: null, dataType: "text" },
  { id: "d3", name: "Sensor type", unit: null, dataType: "text" },
  ...(over as ComparisonDefinition[]),
];

test("a real difference is rendered, with units attached", () => {
  const t = buildComparisonTable({
    products: [R5, R6],
    definitions: defs(),
    specs: [
      { productId: "p1", definitionId: "d1", value: 45 },
      { productId: "p2", definitionId: "d1", value: 20 },
    ],
  });
  const row = t.rows.find((r) => r.definitionId === "d1");
  assert.ok(row);
  assert.equal(row.differs, true);
  assert.deepEqual(row.cells, [
    { kind: "value", text: "45 MP" },
    { kind: "value", text: "20 MP" },
  ]);
});

test("an ABSENT value is 'not recorded', never an empty cell", () => {
  // An empty cell in a spec table is read as "this product does not have that",
  // which is a claim. The only honest rendering of an absent value is one that
  // says it is absent.
  const t = buildComparisonTable({
    products: [R5, R6],
    definitions: defs(),
    specs: [
      { productId: "p1", definitionId: "d1", value: 45 },
      { productId: "p2", definitionId: "d1", value: 20 },
      { productId: "p1", definitionId: "d2", value: "RF" },
      { productId: "p2", definitionId: "d2", value: "RF" },
      // d3 recorded for p1 only -> the row is omitted entirely (see below),
      // so build a third product case to exercise the marker.
    ],
  });
  const t2 = buildComparisonTable({
    products: [R5, R6, { id: "p3", name: "Canon EOS R7", slug: "canon-eos-r7" }],
    definitions: defs(),
    specs: [
      { productId: "p1", definitionId: "d3", value: "CMOS" },
      { productId: "p2", definitionId: "d3", value: "CMOS" },
      // p3 has no d3 row at all.
    ],
  });
  const row = t2.rows.find((r) => r.definitionId === "d3");
  assert.ok(row);
  assert.deepEqual(row.cells[2], { kind: "not_recorded" });
  assert.ok(t.rows.length > 0);
});

test("a row only ONE product has a value for is omitted, and counted", () => {
  // Not a comparison — a fact about one product wearing a comparison's
  // clothes, which makes the other column look deficient when the truth is
  // that nobody recorded anything.
  const t = buildComparisonTable({
    products: [R5, R6],
    definitions: defs(),
    specs: [
      { productId: "p1", definitionId: "d1", value: 45 },
      { productId: "p2", definitionId: "d1", value: 20 },
      { productId: "p1", definitionId: "d2", value: "RF" },
    ],
  });
  assert.equal(t.rows.find((r) => r.definitionId === "d2"), undefined);
  assert.equal(t.omittedForSparseData, 1);
  assert.equal(MIN_PRODUCTS_WITH_VALUE, 2);
});

test("SHARED values are kept, not hidden", () => {
  // "Both of these cameras use the same mount" is frequently the single most
  // useful line in a comparison. A table that silently hid agreement would
  // answer the reader's question by omission.
  const t = buildComparisonTable({
    products: [R5, R6],
    definitions: defs(),
    specs: [
      { productId: "p1", definitionId: "d1", value: 45 },
      { productId: "p2", definitionId: "d1", value: 20 },
      { productId: "p1", definitionId: "d2", value: "RF" },
      { productId: "p2", definitionId: "d2", value: "RF" },
    ],
  });
  const shared = t.rows.find((r) => r.definitionId === "d2");
  assert.ok(shared, "the shared row must still be present");
  assert.equal(shared.differs, false);
});

test("differences are ordered before shared values", () => {
  const t = buildComparisonTable({
    products: [R5, R6],
    definitions: [
      { id: "d2", name: "Lens mount", unit: null, dataType: "text" },
      { id: "d1", name: "Sensor resolution", unit: "MP", dataType: "number" },
    ],
    specs: [
      { productId: "p1", definitionId: "d2", value: "RF" },
      { productId: "p2", definitionId: "d2", value: "RF" },
      { productId: "p1", definitionId: "d1", value: 45 },
      { productId: "p2", definitionId: "d1", value: 20 },
    ],
  });
  assert.equal(t.rows[0].differs, true, "a reader came for the differences");
  assert.equal(t.rows[0].definitionId, "d1");
});

test("booleans read as Yes/No, and empty strings are treated as absent", () => {
  const t = buildComparisonTable({
    products: [R5, R6],
    definitions: [{ id: "b", name: "In-body stabilisation", unit: null, dataType: "boolean" }],
    specs: [
      { productId: "p1", definitionId: "b", value: true },
      { productId: "p2", definitionId: "b", value: false },
    ],
  });
  assert.deepEqual(t.rows[0].cells, [
    { kind: "value", text: "Yes" },
    { kind: "value", text: "No" },
  ]);

  const blank = buildComparisonTable({
    products: [R5, R6],
    definitions: [{ id: "x", name: "Notes", unit: null, dataType: "text" }],
    specs: [
      { productId: "p1", definitionId: "x", value: "   " },
      { productId: "p2", definitionId: "x", value: "" },
    ],
  });
  assert.equal(blank.rows.length, 0, "whitespace is not a specification");
});

test("fewer than two products is not a comparison", () => {
  const t = buildComparisonTable({ products: [R5], definitions: defs(), specs: [] });
  assert.deepEqual(t.rows, []);
  assert.equal(isComparisonWorthRendering(t), false);
});

test("a table with no differing row is not worth rendering", () => {
  // It is a sentence, and better said in prose than dressed as data.
  const t = buildComparisonTable({
    products: [R5, R6],
    definitions: defs(),
    specs: [
      { productId: "p1", definitionId: "d2", value: "RF" },
      { productId: "p2", definitionId: "d2", value: "RF" },
      { productId: "p1", definitionId: "d3", value: "CMOS" },
      { productId: "p2", definitionId: "d3", value: "CMOS" },
    ],
  });
  assert.equal(t.rows.length, 2);
  assert.equal(isComparisonWorthRendering(t), false);
});

test("an unknown definition id is ignored rather than rendered unlabelled", () => {
  const t = buildComparisonTable({
    products: [R5, R6],
    definitions: defs(),
    specs: [
      { productId: "p1", definitionId: "ghost", value: 1 },
      { productId: "p2", definitionId: "ghost", value: 2 },
    ],
  });
  assert.equal(t.rows.length, 0);
});

test("the row count is capped, and the overflow is reported not dropped silently", () => {
  const many = Array.from({ length: MAX_ROWS + 5 }, (_, i) => ({
    id: `d${i}`,
    name: `Spec ${i}`,
    unit: null,
    dataType: "text",
  }));
  const specs = many.flatMap((d, i) => [
    { productId: "p1", definitionId: d.id, value: `a${i}` },
    { productId: "p2", definitionId: d.id, value: `b${i}` },
  ]);
  const t = buildComparisonTable({ products: [R5, R6], definitions: many, specs });
  assert.equal(t.rows.length, MAX_ROWS);
  assert.equal(t.omittedForSparseData, 5);
});
