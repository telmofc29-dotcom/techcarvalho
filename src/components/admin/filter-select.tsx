"use client";

// Small, scoped client component: a <select> that submits its enclosing
// GET form on change, carrying forward the other current filters/search
// term as hidden fields — same minimal-JS pattern as the public site's
// src/components/public/filter-select.tsx, duplicated rather than shared
// across the admin/public boundary since the two areas don't otherwise
// import from each other.
export function AdminFilterSelect({
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
      <label htmlFor={`admin-filter-${paramName}`} className="text-xs font-medium text-neutral-500">
        {label}
      </label>
      <select
        id={`admin-filter-${paramName}`}
        name={paramName}
        defaultValue={value ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/20 focus:border-neutral-400"
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
