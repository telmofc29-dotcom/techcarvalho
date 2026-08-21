// UI-level suggested vocabulary for evidence_records.test_type, which is a
// free-text column with no CHECK constraint (see initial_schema.sql). This
// list is a suggestion to keep entries consistent, not a schema-enforced
// enum — the "other" option lets an editor enter anything the vocabulary
// doesn't cover.
//
// "staff_hands_on_testing" must never be pre-selected or defaulted to
// anywhere it's used — an editor picking it is an explicit claim that
// hands-on testing genuinely happened (see CLAUDE.md's public-site-honesty
// rule).
export const EVIDENCE_TEST_TYPE_OPTIONS = [
  { value: "manufacturer_documentation", label: "Manufacturer documentation" },
  { value: "official_specification", label: "Official specification" },
  { value: "third_party_source", label: "Third-party source" },
  { value: "staff_hands_on_testing", label: "Staff hands-on testing" },
  { value: "staff_photograph", label: "Staff photograph" },
  { value: "observation", label: "Observation" },
  { value: "verification_check", label: "Verification check" },
  { value: "other", label: "Other (specify)" },
] as const;
