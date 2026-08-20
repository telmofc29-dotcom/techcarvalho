"use client";

// Tiny, deliberately-scoped client component: a <select> that submits its
// enclosing GET form on change, so a filter dropdown doesn't need an
// explicit "Apply" button. Everything else on the public site stays
// server-rendered with plain <a>/<form> navigation.
export function FilterSelect({
  label,
  paramName,
  value,
  options,
  otherParams,
  action,
}: {
  label: string;
  paramName: string;
  value?: string;
  options: { value: string; label: string }[];
  otherParams: Record<string, string | undefined>;
  action: string;
}) {
  return (
    <form action={action} method="get" className="flex items-center gap-2">
      {Object.entries(otherParams).map(
        ([key, val]) => val && <input key={key} type="hidden" name={key} value={val} />
      )}
      <label htmlFor={`filter-${paramName}`} className="text-xs font-medium text-zinc-500">
        {label}
      </label>
      <select
        id={`filter-${paramName}`}
        name={paramName}
        defaultValue={value ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-full border border-border-subtle bg-white px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </form>
  );
}
