"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/admin/ui";
import {
  bulkPublishMediaAssets,
  bulkUnpublishMediaAssets,
  bulkSetRightsStatus,
  bulkDeleteMediaAssets,
  inspectMediaForDeletion,
  type BulkActionSummary,
  type BulkDeleteSummary,
} from "./actions";
import type { MediaDeletionAssessment } from "@/lib/media/deletion-safety";
import type { MediaRightsStatus } from "@/lib/types/database";

type MediaItem = {
  id: string;
  storage_path: string;
  media_type: string;
  alt_text: string | null;
  publication_status: string;
  rights_status: MediaRightsStatus | null;
  brand_role: string | null;
  previewUrl: string | null;
};

const RIGHTS_TONE: Record<string, "red" | "amber" | "green" | "neutral"> = {
  restricted: "red",
  pending_verification: "amber",
  verified: "green",
  unknown: "neutral",
};

// Client wrapper adding multi-select + a bulk-action toolbar over the
// server-rendered media grid. The grid markup itself matches the previous
// server-only version exactly (same card layout/badges) — only selection
// state and the floating toolbar are new.
export function MediaGrid({ items }: { items: MediaItem[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [lastSummary, setLastSummary] = useState<{ action: string; summary: BulkActionSummary } | null>(null);

  // DELETE IS TWO STEPS, ALWAYS.
  //
  // `pendingDelete` holds the server's own assessment of what would happen —
  // not a count, and not a generic "are you sure". The admin sees each filename
  // and, for anything attached, exactly what it is attached to. Nothing is sent
  // back to the delete action until they press the second button.
  //
  // This is confirmation, not protection: the server refuses attached assets
  // whatever this component sends. See inspectMediaForDeletion.
  const [pendingDelete, setPendingDelete] = useState<MediaDeletionAssessment[] | null>(null);
  const [deleteResult, setDeleteResult] = useState<BulkDeleteSummary | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runBulk(action: string, fn: () => Promise<BulkActionSummary>) {
    startTransition(async () => {
      const summary = await fn();
      setLastSummary({ action, summary });
      setSelected(new Set());
    });
  }

  function askToDelete() {
    setDeleteResult(null);
    startTransition(async () => {
      setPendingDelete(await inspectMediaForDeletion(Array.from(selected)));
    });
  }

  function confirmDelete() {
    const deletable = (pendingDelete ?? []).filter((a) => !a.blocked).map((a) => a.id);
    startTransition(async () => {
      const summary = await bulkDeleteMediaAssets(deletable);
      setDeleteResult(summary);
      setPendingDelete(null);
      setSelected(new Set());
    });
  }

  const ids = Array.from(selected);
  const deletable = (pendingDelete ?? []).filter((a) => !a.blocked);
  const blocked = (pendingDelete ?? []).filter((a) => a.blocked);

  return (
    <div className="flex flex-col gap-4">
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border border-neutral-300 bg-white p-3 shadow-sm">
          <p className="text-sm font-medium text-neutral-800">{selected.size} selected</p>
          <button
            type="button"
            disabled={isPending}
            onClick={() => runBulk("publish", () => bulkPublishMediaAssets(ids))}
            className="rounded px-3 py-1.5 text-xs font-medium bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            Publish eligible
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => runBulk("unpublish", () => bulkUnpublishMediaAssets(ids))}
            className="rounded px-3 py-1.5 text-xs font-medium border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Unpublish
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => runBulk("mark verified", () => bulkSetRightsStatus(ids, "verified"))}
            className="rounded px-3 py-1.5 text-xs font-medium border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Mark rights Verified
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={askToDelete}
            className="rounded px-3 py-1.5 text-xs font-medium border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Delete selected ({selected.size})
          </button>
          <button
            type="button"
            onClick={() => {
              setSelected(new Set());
              setPendingDelete(null);
            }}
            className="ml-auto text-xs text-neutral-500 hover:text-neutral-800"
          >
            Clear selection
          </button>
        </div>
      )}

      {pendingDelete && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm">
          <p className="font-medium text-red-900">
            Delete {deletable.length} of {pendingDelete.length} selected file
            {pendingDelete.length === 1 ? "" : "s"}?
          </p>
          <p className="mt-1 text-xs text-red-800">
            This removes the database row and both storage copies. It cannot be undone.
          </p>

          {deletable.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-red-900">Will be deleted:</p>
              <ul className="mt-1 flex flex-col gap-1">
                {deletable.map((a) => (
                  <li key={a.id} className="text-xs text-red-900">
                    <span className="font-mono">{a.filename}</span>
                    {a.relationships.length > 0 && (
                      <span className="text-red-700"> — {a.relationships.map((r) => r.label).join("; ")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {blocked.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium text-neutral-800">
                Kept — {blocked.length} file{blocked.length === 1 ? " is" : "s are"} still in use:
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {blocked.map((a) => (
                  <li key={a.id} className="text-xs text-neutral-700">
                    <span className="font-mono">{a.filename}</span> — {a.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled={isPending || deletable.length === 0}
              onClick={confirmDelete}
              className="rounded px-3 py-1.5 text-xs font-medium bg-red-700 text-white hover:bg-red-800 disabled:opacity-50"
            >
              {deletable.length === 0
                ? "Nothing can be deleted"
                : `Yes, permanently delete ${deletable.length} file${deletable.length === 1 ? "" : "s"}`}
            </button>
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="text-xs text-neutral-600 hover:text-neutral-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {deleteResult && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
          <p className="font-medium">
            Delete: {deleteResult.deleted.length} of {deleteResult.requested} removed
            {deleteResult.refused.length > 0 && `, ${deleteResult.refused.length} refused`}
            {deleteResult.failed.length > 0 && `, ${deleteResult.failed.length} failed`}
          </p>
          {/* Every non-deletion is named. A partial result that reported only a
              success count would be indistinguishable from a complete one. */}
          {deleteResult.refused.map((r) => (
            <p key={r.id} className="mt-1">
              kept <span className="font-mono">{r.filename}</span> — {r.reason}
            </p>
          ))}
          {deleteResult.failed.map((r) => (
            <p key={r.id} className="mt-1 text-red-700">
              FAILED <span className="font-mono">{r.filename}</span> — {r.reason}
            </p>
          ))}
          {deleteResult.storageOrphans.length > 0 && (
            <p className="mt-1 text-amber-800">
              {deleteResult.storageOrphans.length} storage object(s) could not be removed and are now orphaned:{" "}
              {deleteResult.storageOrphans.join(", ")}
            </p>
          )}
        </div>
      )}

      {lastSummary && (
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600">
          {lastSummary.action}: {lastSummary.summary.succeeded} succeeded
          {lastSummary.summary.skipped.length > 0 && (
            <>
              , {lastSummary.summary.skipped.length} skipped —{" "}
              {lastSummary.summary.skipped.map((s) => s.reason).slice(0, 2).join("; ")}
              {lastSummary.summary.skipped.length > 2 ? "…" : ""}
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((m) => {
          const isPublished = m.publication_status === "published";
          const rightsStatus = m.rights_status ?? "unknown";
          const isSelected = selected.has(m.id);
          return (
            <div
              key={m.id}
              className={`relative rounded-lg border bg-white overflow-hidden ${isSelected ? "border-neutral-900 ring-1 ring-neutral-900" : "border-neutral-200 hover:border-neutral-400"}`}
            >
              <label className="absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded bg-white/90 shadow">
                <span className="sr-only">Select {m.storage_path.split("/").pop()}</span>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(m.id)}
                  className="h-4 w-4 rounded border-neutral-300"
                />
              </label>
              <Link href={`/admin/media/${m.id}`}>
                <div className="aspect-video bg-neutral-100 relative flex items-center justify-center">
                  {m.media_type === "image" && m.previewUrl ? (
                    <Image src={m.previewUrl} alt={m.alt_text ?? ""} fill className="object-cover" unoptimized />
                  ) : (
                    <span className="text-xs text-neutral-500">{m.media_type === "video" ? "Video" : "No preview"}</span>
                  )}
                </div>
                <div className="p-2 flex flex-col gap-1">
                  <p className="text-xs text-neutral-700 truncate">{m.storage_path.split("/").pop()}</p>
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={isPublished ? "green" : "neutral"}>{isPublished ? "Published" : "Private"}</Badge>
                    <Badge tone={RIGHTS_TONE[rightsStatus]}>{rightsStatus.replace("_", " ")}</Badge>
                    {m.brand_role && <Badge tone="amber">Brand</Badge>}
                  </div>
                </div>
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
