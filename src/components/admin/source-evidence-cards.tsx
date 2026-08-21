import { Card, Field, TextInput, Select, Textarea, Badge } from "@/components/admin/ui";
import { SubmitButton, ConfirmDeleteButton } from "@/components/admin/submit-button";
import { addSourceRecord, deleteSourceRecord, type SourceParent } from "@/app/admin/(dashboard)/source-records/actions";
import { addEvidenceRecord, deleteEvidenceRecord, type EvidenceParent } from "@/app/admin/(dashboard)/evidence-records/actions";
import { EVIDENCE_TEST_TYPE_OPTIONS } from "@/lib/admin/evidence-test-types";
import type { ReliabilityTier } from "@/lib/types/database";

const RELIABILITY_LABELS: Record<ReliabilityTier, string> = {
  primary: "Primary",
  secondary: "Secondary",
  community: "Community",
};

const RELIABILITY_TONE: Record<ReliabilityTier, "green" | "blue" | "neutral"> = {
  primary: "green",
  secondary: "blue",
  community: "neutral",
};

type SourceRecordRow = {
  id: string;
  url: string;
  publisher: string | null;
  reliability_tier: ReliabilityTier;
  retrieved_at: string;
};

export function SourceRecordsCard({ parent, records }: { parent: SourceParent; records: SourceRecordRow[] }) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-neutral-900 mb-1">Sources</h2>
      <p className="text-xs text-neutral-500 mb-3">
        Where facts about this {parent.type} were verified. Every claim worth defending should trace back to one of
        these.
      </p>
      {records.length === 0 ? (
        <p className="text-sm text-neutral-500 mb-4">No sources recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 mb-4">
          {records.map((record) => (
            <li key={record.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 flex-1">
                <Badge tone={RELIABILITY_TONE[record.reliability_tier]}>
                  {RELIABILITY_LABELS[record.reliability_tier]}
                </Badge>{" "}
                <a
                  href={record.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-neutral-900 break-all"
                >
                  {record.publisher || record.url}
                </a>
                <span className="text-neutral-400 text-xs ml-2">
                  {new Date(record.retrieved_at).toLocaleDateString()}
                </span>
              </span>
              <form action={deleteSourceRecord}>
                <input type="hidden" name="id" value={record.id} />
                <input type="hidden" name="parent_type" value={parent.type} />
                <input type="hidden" name="parent_id" value={parent.id} />
                <ConfirmDeleteButton confirmMessage="Remove this source record?" label="Remove" />
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={addSourceRecord.bind(null, parent)} className="flex flex-col gap-3">
        <Field label="Source URL" htmlFor="source_url">
          <TextInput id="source_url" name="url" type="url" required placeholder="https://..." />
        </Field>
        <div className="flex gap-3">
          <div className="flex-1">
            <Field label="Publisher" htmlFor="source_publisher" hint="Optional">
              <TextInput id="source_publisher" name="publisher" placeholder="e.g. Manufacturer spec sheet" />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="Reliability" htmlFor="source_reliability">
              <Select id="source_reliability" name="reliability_tier" defaultValue="secondary">
                <option value="primary">Primary</option>
                <option value="secondary">Secondary</option>
                <option value="community">Community</option>
              </Select>
            </Field>
          </div>
        </div>
        <div>
          <SubmitButton pendingLabel="Adding...">Add source</SubmitButton>
        </div>
      </form>
    </Card>
  );
}

type EvidenceRecordRow = {
  id: string;
  test_type: string;
  conditions: string | null;
  result_summary: string;
  tested_at: string;
};

export function EvidenceRecordsCard({ parent, records }: { parent: EvidenceParent; records: EvidenceRecordRow[] }) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-neutral-900 mb-1">Evidence</h2>
      <p className="text-xs text-neutral-500 mb-3">
        Genuine testing, observation, or verification behind this {parent.type}&apos;s claims. Only choose
        &quot;Staff hands-on testing&quot; if hands-on testing actually happened.
      </p>
      {records.length === 0 ? (
        <p className="text-sm text-neutral-500 mb-4">No evidence recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-2 mb-4">
          {records.map((record) => (
            <li key={record.id} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0 flex-1">
                <Badge>{record.test_type}</Badge>
                <p className="text-neutral-700 mt-1">{record.result_summary}</p>
                {record.conditions && (
                  <p className="text-neutral-500 text-xs mt-0.5">Conditions: {record.conditions}</p>
                )}
                <span className="text-neutral-400 text-xs">{new Date(record.tested_at).toLocaleDateString()}</span>
              </span>
              <form action={deleteEvidenceRecord}>
                <input type="hidden" name="id" value={record.id} />
                <input type="hidden" name="parent_type" value={parent.type} />
                <input type="hidden" name="parent_id" value={parent.id} />
                <ConfirmDeleteButton confirmMessage="Remove this evidence record?" label="Remove" />
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={addEvidenceRecord.bind(null, parent)} className="flex flex-col gap-3">
        <Field label="Evidence type" htmlFor="evidence_test_type">
          <Select id="evidence_test_type" name="test_type" defaultValue="" required>
            <option value="" disabled>
              Choose a type
            </option>
            {EVIDENCE_TEST_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={'If "Other", specify'}
          htmlFor="evidence_test_type_other"
          hint="Only used when Other is selected above"
        >
          <TextInput id="evidence_test_type_other" name="test_type_other" />
        </Field>
        <Field label="Result summary" htmlFor="evidence_result_summary">
          <Textarea id="evidence_result_summary" name="result_summary" required rows={3} />
        </Field>
        <Field label="Conditions" htmlFor="evidence_conditions" hint="Optional — testing environment, sample size, etc.">
          <TextInput id="evidence_conditions" name="conditions" />
        </Field>
        <Field label="Raw data (JSON)" htmlFor="evidence_raw_data" hint="Optional — must be valid JSON if provided">
          <Textarea id="evidence_raw_data" name="raw_data" rows={2} />
        </Field>
        <div>
          <SubmitButton pendingLabel="Adding...">Add evidence</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
