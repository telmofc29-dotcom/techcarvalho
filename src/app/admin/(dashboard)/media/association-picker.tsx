"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { MediaRole } from "@/lib/types/database";

export type AssociationTarget = {
  id: string;
  label: string;
  /** Category, type, manufacturer — whatever narrows a search usefully. */
  facet: string | null;
  /** "published" | "draft" etc. Shown so a draft target is obvious. */
  status: string;
  currentRole: MediaRole | null;
};

// A searchable association picker.
//
// WHY THIS REPLACED THE OLD CONTROL
// ---------------------------------
// The media page rendered EVERY article and EVERY product as a row with a
// dropdown beside it. At 84 articles and 287 products that is 371 select
// elements on one page, and finding the one you want meant scrolling past all
// of them. It does not survive the library growing, and it was already painful.
//
// This shows what is ALREADY attached at the top — the thing you most often
// want to check — and everything else only when you search for it. The
// underlying form contract is unchanged: each row still submits
// role_<targetId>, so the collision handling and PATCH semantics behind it are
// exactly the same code.
export function AssociationPicker({
  targets,
  kindLabel,
  facetLabel,
}: {
  targets: AssociationTarget[];
  kindLabel: string;
  facetLabel: string;
}) {
  const [query, setQuery] = useState("");
  const [facet, setFacet] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [extra, setExtra] = useState<Record<string, MediaRole | "">>({});

  const attached = useMemo(() => targets.filter((t) => t.currentRole), [targets]);
  const attachedIds = useMemo(() => new Set(attached.map((t) => t.id)), [attached]);

  const facets = useMemo(
    () => [...new Set(targets.map((t) => t.facet).filter((f): f is string => Boolean(f)))].sort(),
    [targets]
  );
  const statuses = useMemo(() => [...new Set(targets.map((t) => t.status))].sort(), [targets]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Nothing is listed until the search narrows it — the whole point is not
    // rendering hundreds of rows nobody asked for.
    if (!q && !facet && !statusFilter) return [];
    return targets
      .filter((t) => !attachedIds.has(t.id))
      .filter((t) => (facet ? t.facet === facet : true))
      .filter((t) => (statusFilter ? t.status === statusFilter : true))
      .filter((t) => (q ? t.label.toLowerCase().includes(q) : true))
      .slice(0, 40);
  }, [targets, query, facet, statusFilter, attachedIds]);

  return (
    <div className="flex flex-col gap-4">
      {/* Already attached — always visible, never hidden behind a search. */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Currently attached {attached.length > 0 && <span className="font-normal text-neutral-400">({attached.length})</span>}
        </h3>
        {attached.length === 0 ? (
          <p className="text-sm text-neutral-500">Not attached to any {kindLabel} yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {attached.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded border border-neutral-200 bg-white p-2">
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">{t.label}</span>
                {t.status !== "published" && (
                  <span className="rounded bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">{t.status}</span>
                )}
                <RoleSelect targetId={t.id} defaultValue={t.currentRole ?? ""} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Search to add more. */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Attach to another {kindLabel}</h3>
        <div className="mb-2 flex flex-wrap gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${kindLabel}…`}
            aria-label={`Search ${kindLabel}`}
            className="min-w-[14rem] flex-1 rounded border border-neutral-300 px-2 py-1.5 text-sm"
          />
          {facets.length > 1 && (
            <select
              value={facet}
              onChange={(e) => setFacet(e.target.value)}
              aria-label={facetLabel}
              className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="">All {facetLabel}</option>
              {facets.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}
          {statuses.length > 1 && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Status"
              className="rounded border border-neutral-300 px-2 py-1.5 text-sm"
            >
              <option value="">Any status</option>
              {statuses.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          )}
        </div>

        {matches.length === 0 ? (
          <p className="text-xs text-neutral-500">
            {query || facet || statusFilter
              ? `No unattached ${kindLabel} match that.`
              : `Start typing to find a ${kindLabel.replace(/s$/, "")}. ${targets.length} available.`}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {matches.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 rounded border border-neutral-200 bg-white p-2">
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-800">{t.label}</span>
                {t.facet && <span className="rounded bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">{t.facet}</span>}
                {t.status !== "published" && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900">{t.status}</span>
                )}
                <RoleSelect
                  targetId={t.id}
                  defaultValue={extra[t.id] ?? ""}
                  onChange={(v) => setExtra((prev) => ({ ...prev, [t.id]: v }))}
                />
              </li>
            ))}
          </ul>
        )}

        {/* A role chosen on a search result has to survive the list changing,
            so the choice is mirrored into a hidden field that stays in the form
            even after the search text moves on. */}
        {Object.entries(extra)
          .filter(([id, role]) => role && !attachedIds.has(id))
          .map(([id, role]) => (
            <input key={id} type="hidden" name={`role_${id}`} value={role} />
          ))}
      </div>
    </div>
  );
}

function RoleSelect({
  targetId,
  defaultValue,
  onChange,
}: {
  targetId: string;
  defaultValue: MediaRole | "";
  onChange?: (value: MediaRole | "") => void;
}) {
  // Controlled only when the caller cares (search results, whose rows unmount);
  // uncontrolled for attached rows so their submitted value is the stored one.
  const common = "w-36 rounded border border-neutral-300 px-2 py-1 text-sm";
  if (onChange) {
    return (
      <select
        name={`__pick_${targetId}`}
        value={defaultValue}
        onChange={(e) => onChange(e.target.value as MediaRole | "")}
        aria-label="Role"
        className={common}
      >
        <option value="">Not linked</option>
        <option value="hero">Hero</option>
        <option value="thumbnail">Thumbnail / card</option>
        <option value="gallery">Gallery</option>
      </select>
    );
  }
  return (
    <select name={`role_${targetId}`} defaultValue={defaultValue} aria-label="Role" className={common}>
      <option value="">Not linked</option>
      <option value="hero">Hero</option>
      <option value="thumbnail">Thumbnail / card</option>
      <option value="gallery">Gallery</option>
    </select>
  );
}

export { Link };
