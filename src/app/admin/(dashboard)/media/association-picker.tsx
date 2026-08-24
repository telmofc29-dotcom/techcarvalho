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
  /** EVERY slot this asset occupies on that target, not just one. */
  currentRoles: MediaRole[];
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
  const [extra, setExtra] = useState<Record<string, MediaRole[]>>({});

  const attached = useMemo(() => targets.filter((t) => t.currentRoles.length > 0), [targets]);
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
                <SlotChecks targetId={t.id} current={t.currentRoles} />
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
                <SlotChecks
                  targetId={t.id}
                  current={extra[t.id] ?? []}
                  onChange={(roles) => setExtra((prev) => ({ ...prev, [t.id]: roles }))}
                />
              </li>
            ))}
          </ul>
        )}

        {/* A role chosen on a search result has to survive the list changing,
            so the choice is mirrored into a hidden field that stays in the form
            even after the search text moves on. */}
        {Object.entries(extra)
          .filter(([id, roles]) => roles.length > 0 && !attachedIds.has(id))
          .flatMap(([id, roles]) => [
            <input key={`${id}-scope`} type="hidden" name={`scope_${id}`} value="1" />,
            ...roles.map((role) => <input key={`${id}-${role}`} type="hidden" name={`roles_${id}`} value={role} />),
          ])}
      </div>
    </div>
  );
}

const SLOTS: { role: MediaRole; label: string; hint: string }[] = [
  { role: "hero", label: "Hero", hint: "The main image on the page. One per article or product." },
  { role: "thumbnail", label: "Thumbnail / card", hint: "Used on listings and the homepage. One per article or product." },
  { role: "gallery", label: "Gallery", hint: "Any number of images." },
];

/**
 * The slots ONE asset occupies on ONE target.
 *
 * Checkboxes, not a dropdown, because these are not alternatives — the same
 * master legitimately serves as hero AND card AND a gallery entry, and a single
 * <select> made that impossible to express. Every box submits roles_<targetId>,
 * so the action receives a set rather than a value.
 */
function SlotChecks({
  targetId,
  current,
  onChange,
}: {
  targetId: string;
  current: MediaRole[];
  onChange?: (roles: MediaRole[]) => void;
}) {
  const [roles, setRoles] = useState<MediaRole[]>(current);

  function toggle(role: MediaRole, on: boolean) {
    const next = on ? [...new Set([...roles, role])] : roles.filter((r) => r !== role);
    setRoles(next);
    onChange?.(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Declares that this row was on the form, so clearing every box is a
          real instruction rather than an absent field. */}
      <input type="hidden" name={`scope_${targetId}`} value="1" />
      {SLOTS.map((slot) => (
        <label key={slot.role} className="flex items-center gap-1.5 text-sm" title={slot.hint}>
          <input
            type="checkbox"
            name={`roles_${targetId}`}
            value={slot.role}
            checked={roles.includes(slot.role)}
            onChange={(e) => toggle(slot.role, e.target.checked)}
          />
          <span>{slot.label}</span>
        </label>
      ))}
    </div>
  );
}

export { Link };
