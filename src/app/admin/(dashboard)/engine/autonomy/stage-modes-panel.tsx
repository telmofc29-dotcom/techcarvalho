import { Card, Select } from "@/components/admin/ui";
import { Badge } from "@/components/shared/ui";
import { SubmitButton } from "@/components/admin/submit-button";
import { ENGINE_STAGE_NAMES, type EngineStageName } from "@/lib/engine/stages";
import {
  resolveAllStageModes,
  describeStageMode,
  automaticIsAvailable,
  AUTOMATIC_REFUSAL,
  STAGE_MODES,
  STAGE_MODE_LABELS,
  STAGE_MODE_DESCRIPTIONS,
} from "@/lib/engine/stage-modes";
import { updateStageModes } from "../actions";

// PER-STAGE OPERATING MODES.
//
// Rendered read-only until the migration that adds `engine_settings.stage_modes`
// is applied. That is the honest state: without the column a save silently
// fails, and a form that appears to work and does not is worse than one that
// says why it cannot.
//
// AUTOMATIC is not offered for stages that cannot honour it. Offering it and
// then quietly resolving it back to ASSISTED is precisely the display-only
// behaviour these modes replace, so the option is absent and the reason is
// printed in its place.

export function StageModesPanel({
  storedModes,
  columnExists,
}: {
  storedModes: unknown;
  columnExists: boolean;
}) {
  const resolved = resolveAllStageModes(storedModes);

  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          Operating modes
        </h2>
        {!columnExists && <Badge tone="amber">Migration not applied</Badge>}
      </div>

      <Card className="p-5">
        <div className="mb-4 space-y-1">
          {STAGE_MODES.map((m) => (
            <p key={m} className="text-sm text-neutral-600">
              <span className="font-medium text-neutral-900">{STAGE_MODE_LABELS[m]}</span> —{" "}
              {STAGE_MODE_DESCRIPTIONS[m]}
            </p>
          ))}
        </div>

        {!columnExists && (
          <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm text-amber-800">
              These are shown read-only because{" "}
              <code className="text-xs">engine_settings.stage_modes</code> does not exist yet. Apply{" "}
              <code className="text-xs">
                supabase/migrations_pending/20260824_stage_modes.sql
              </code>{" "}
              to enable editing. Every stage currently runs as{" "}
              <strong>Assisted</strong>, which is exactly what the engine already does — applying
              the migration on its own changes no behaviour.
            </p>
          </div>
        )}

        <form action={updateStageModes}>
          <div className="space-y-3">
            {ENGINE_STAGE_NAMES.map((stage) => (
              <StageRow
                key={stage}
                stage={stage}
                mode={resolved[stage].mode}
                refusedBecause={resolved[stage].refusedBecause}
                disabled={!columnExists}
              />
            ))}
          </div>

          {columnExists && (
            <div className="mt-5">
              <SubmitButton>Save operating modes</SubmitButton>
            </div>
          )}
        </form>

        <p className="mt-5 text-sm text-neutral-500 max-w-prose">
          No mode can publish. The engine has no publishing function to call — assembly hard-wires
          drafts and unpublished products — so even Automatic on every stage cannot put a page in
          front of a reader.
        </p>
      </Card>
    </div>
  );
}

function StageRow({
  stage,
  mode,
  refusedBecause,
  disabled,
}: {
  stage: EngineStageName;
  mode: string;
  refusedBecause: string | null;
  disabled: boolean;
}) {
  const canAutomate = automaticIsAvailable(stage);

  return (
    <div className="grid gap-2 sm:grid-cols-[220px_150px_1fr] sm:items-start border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0">
      <label
        htmlFor={`mode_${stage}`}
        className="text-sm font-medium text-neutral-900 font-mono"
      >
        {stage.replace(/_/g, " ")}
      </label>

      <Select
        id={`mode_${stage}`}
        name={`mode_${stage}`}
        defaultValue={mode}
        disabled={disabled}
      >
        {STAGE_MODES.filter((m) => m !== "AUTOMATIC" || canAutomate).map((m) => (
          <option key={m} value={m}>
            {STAGE_MODE_LABELS[m]}
          </option>
        ))}
      </Select>

      <div className="min-w-0">
        <p className="text-sm text-neutral-600">{describeStageMode(stage, mode as never)}</p>
        {!canAutomate && (
          <p className="mt-0.5 text-xs text-neutral-400">
            Automatic unavailable — {AUTOMATIC_REFUSAL[stage]}
          </p>
        )}
        {refusedBecause && (
          <p className="mt-0.5 text-xs text-amber-700">
            A stored Automatic setting was refused: {refusedBecause}
          </p>
        )}
      </div>
    </div>
  );
}
