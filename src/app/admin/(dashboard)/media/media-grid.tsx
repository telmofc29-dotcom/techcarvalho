"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/admin/ui";
import { bulkPublishMediaAssets, bulkUnpublishMediaAssets, bulkSetRightsStatus, type BulkActionSummary } from "./actions";
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

  const ids = Array.from(selected);

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
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-neutral-500 hover:text-neutral-800"
          >
            Clear selection
          </button>
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
