"use client";

import { useActionState } from "react";
import { Field, TextInput, Textarea, Select, Checkbox } from "./ui";
import { SubmitButton } from "./submit-button";

export type SelectOption = { value: string; label: string };

export type ReferenceFieldConfig =
  | { key: string; label: string; kind: "text"; required?: boolean; hint?: string; placeholder?: string }
  | { key: string; label: string; kind: "textarea"; hint?: string }
  | { key: string; label: string; kind: "url"; hint?: string }
  | { key: string; label: string; kind: "date"; hint?: string }
  | { key: string; label: string; kind: "datetime"; hint?: string }
  | { key: string; label: string; kind: "number"; required?: boolean; hint?: string }
  | { key: string; label: string; kind: "checkbox" }
  | {
      key: string;
      label: string;
      kind: "select";
      required?: boolean;
      allowEmpty?: boolean;
      emptyLabel?: string;
      options: SelectOption[];
    };

export type FormState = { error: string | null };

export function ReferenceForm({
  fields,
  defaultValues,
  action,
  submitLabel,
  extra,
}: {
  fields: ReferenceFieldConfig[];
  defaultValues?: Record<string, unknown>;
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  extra?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-4 max-w-xl">
      {fields.map((field) => {
        const value = defaultValues?.[field.key];

        if (field.kind === "checkbox") {
          return (
            <Checkbox
              key={field.key}
              id={field.key}
              name={field.key}
              label={field.label}
              defaultChecked={Boolean(value)}
            />
          );
        }

        if (field.kind === "select") {
          return (
            <Field key={field.key} label={field.label} htmlFor={field.key}>
              <Select
                id={field.key}
                name={field.key}
                defaultValue={(value as string) ?? ""}
                required={field.required}
              >
                {field.allowEmpty !== false && <option value="">{field.emptyLabel ?? "—"}</option>}
                {field.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </Field>
          );
        }

        if (field.kind === "textarea") {
          return (
            <Field key={field.key} label={field.label} htmlFor={field.key} hint={field.hint}>
              <Textarea id={field.key} name={field.key} defaultValue={(value as string) ?? ""} rows={4} />
            </Field>
          );
        }

        if (field.kind === "number") {
          return (
            <Field key={field.key} label={field.label} htmlFor={field.key} hint={field.hint}>
              <TextInput
                type="number"
                id={field.key}
                name={field.key}
                defaultValue={(value as number | undefined)?.toString() ?? ""}
                required={field.required}
              />
            </Field>
          );
        }

        return (
          <Field key={field.key} label={field.label} htmlFor={field.key} hint={field.hint}>
            <TextInput
              type={
                field.kind === "url"
                  ? "url"
                  : field.kind === "date"
                    ? "date"
                    : field.kind === "datetime"
                      ? "datetime-local"
                      : "text"
              }
              id={field.key}
              name={field.key}
              defaultValue={(value as string) ?? ""}
              required={field.kind === "text" ? field.required : undefined}
              placeholder={field.kind === "text" ? field.placeholder : undefined}
            />
          </Field>
        );
      })}
      {extra}
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
