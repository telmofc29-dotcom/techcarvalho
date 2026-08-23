"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { Field, TextInput, Textarea, Select, Checkbox } from "@/components/admin/ui";
import { uploadMediaAssetBatchItem } from "./actions";
// Rendered from the same module the server action validates against, so a menu
// entry the server would refuse cannot exist. See src/lib/media/form-options.ts.
import {
  ASSET_ROLE_OPTIONS,
  BRAND_ROLE_OPTIONS,
  MEDIA_TYPE_OPTIONS,
  RIGHTS_STATUS_OPTIONS,
  SOURCE_TYPE_OPTIONS,
} from "@/lib/media/form-options";

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15MB — generous for photography/logo assets, well under
// Supabase's own default upload limits, and small enough that a batch of a
// dozen files doesn't strain the browser tab.
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

type FileStatus = "pending" | "reading" | "uploading" | "done" | "error";

type BatchFile = {
  key: string;
  file: File;
  previewUrl: string | null;
  width: number | null;
  height: number | null;
  status: FileStatus;
  error: string | null;
  duplicateWarning: string | null;
  resultId: string | null;
};

function sanitizeCompare(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

function detectMediaType(file: File): "image" | "video" | null {
  if (ACCEPTED_IMAGE_TYPES.includes(file.type)) return "image";
  if (ACCEPTED_VIDEO_TYPES.includes(file.type)) return "video";
  return null;
}

function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

export function MediaUploadForm({ existingFileNames }: { existingFileNames: string[] }) {
  const [files, setFiles] = useState<BatchFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [owned, setOwned] = useState(false);
  const [assetRole, setAssetRole] = useState("");
  const [batchDone, setBatchDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const existingSet = useRef(new Set(existingFileNames.map(sanitizeCompare)));

  async function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    const entries: BatchFile[] = incoming.map((file) => ({
      key: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      file,
      previewUrl: null,
      width: null,
      height: null,
      status: "reading",
      error: null,
      duplicateWarning: existingSet.current.has(sanitizeCompare(file.name))
        ? "A file with this name already exists in the library — this will still upload as a new, separate asset."
        : null,
      resultId: null,
    }));

    setFiles((prev) => [...prev, ...entries]);

    for (const entry of entries) {
      const mediaType = detectMediaType(entry.file);
      let error: string | null = null;
      if (!mediaType) {
        error = `Unsupported file type (${entry.file.type || "unknown"}). Use JPG, PNG, WebP, GIF, SVG, or a common video format.`;
      } else if (entry.file.size > MAX_FILE_SIZE_BYTES) {
        error = `File is ${(entry.file.size / 1024 / 1024).toFixed(1)}MB — over the ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB limit.`;
      }

      let previewUrl: string | null = null;
      let dims: { width: number; height: number } | null = null;
      if (!error && mediaType === "image") {
        previewUrl = URL.createObjectURL(entry.file);
        dims = await readImageDimensions(entry.file);
      }

      setFiles((prev) =>
        prev.map((f) =>
          f.key === entry.key
            ? {
                ...f,
                status: error ? "error" : "pending",
                error,
                previewUrl,
                width: dims?.width ?? null,
                height: dims?.height ?? null,
              }
            : f
        )
      );
    }
  }

  function removeFile(key: string) {
    setFiles((prev) => {
      const target = prev.find((f) => f.key === key);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.key !== key);
    });
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
  }

  function uploadBatch(formEl: HTMLFormElement) {
    const sharedData = new FormData(formEl);
    const uploadable = files.filter((f) => f.status === "pending" || f.status === "error");

    startTransition(async () => {
      for (const entry of uploadable) {
        setFiles((prev) => prev.map((f) => (f.key === entry.key ? { ...f, status: "uploading", error: null } : f)));

        const perFile = new FormData();
        for (const [key, value] of sharedData.entries()) perFile.append(key, value);
        perFile.set("file", entry.file);
        if (entry.width) perFile.set("width", String(entry.width));
        if (entry.height) perFile.set("height", String(entry.height));

        const result = await uploadMediaAssetBatchItem(perFile);

        setFiles((prev) =>
          prev.map((f) =>
            f.key === entry.key
              ? result.error
                ? { ...f, status: "error", error: result.error }
                : { ...f, status: "done", resultId: result.id }
              : f
          )
        );
      }
      setBatchDone(true);
    });
  }

  const hasUploadableFiles = files.some((f) => f.status === "pending");
  const allDone = files.length > 0 && files.every((f) => f.status === "done");
  const someFailed = files.some((f) => f.status === "error" && !f.error?.startsWith("Unsupported") && !f.error?.startsWith("File is"));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        uploadBatch(e.currentTarget);
      }}
      className="flex flex-col gap-6 max-w-2xl"
    >
      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          isDragOver ? "border-neutral-900 bg-neutral-50" : "border-neutral-300 bg-white"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-10 w-10 text-neutral-400" fill="none" aria-hidden="true">
          <path
            d="M12 16V4m0 0L7 9m5-5l5 5M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <p className="text-sm font-medium text-neutral-800">Drag files here to upload</p>
        <p className="text-xs text-neutral-500">or</p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded px-4 py-2 text-sm font-medium bg-neutral-900 text-white hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
        >
          Browse files
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={[...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES].join(",")}
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
          className="sr-only"
        />
        <p className="text-xs text-neutral-400">JPG, PNG, WebP, GIF, SVG, or video — up to {MAX_FILE_SIZE_BYTES / 1024 / 1024}MB each</p>
      </div>

      {/* Per-file list */}
      {files.length > 0 && (
        <ul className="flex flex-col gap-2">
          {files.map((f) => (
            <li key={f.key} className="flex items-center gap-3 rounded-lg border border-neutral-200 bg-white p-2">
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded bg-neutral-100">
                {f.previewUrl ? (
                  <Image src={f.previewUrl} alt="" fill className="object-cover" unoptimized />
                ) : (
                  <div className="flex h-full items-center justify-center text-[10px] text-neutral-400">No preview</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-neutral-800">{f.file.name}</p>
                <p className="text-xs text-neutral-500">{(f.file.size / 1024).toFixed(0)}KB</p>
                {f.width != null && (f.status === "pending" || f.status === "error") && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-neutral-500">
                    <span>Detected:</span>
                    <input
                      type="number"
                      value={f.width}
                      onChange={(e) =>
                        setFiles((prev) =>
                          prev.map((p) => (p.key === f.key ? { ...p, width: Number(e.target.value) || null } : p))
                        )
                      }
                      className="w-16 rounded border border-neutral-300 px-1 py-0.5"
                      aria-label={`Width override for ${f.file.name}`}
                    />
                    <span>×</span>
                    <input
                      type="number"
                      value={f.height ?? ""}
                      onChange={(e) =>
                        setFiles((prev) =>
                          prev.map((p) => (p.key === f.key ? { ...p, height: Number(e.target.value) || null } : p))
                        )
                      }
                      className="w-16 rounded border border-neutral-300 px-1 py-0.5"
                      aria-label={`Height override for ${f.file.name}`}
                    />
                  </div>
                )}
                {f.duplicateWarning && <p className="text-xs text-amber-600">{f.duplicateWarning}</p>}
                {f.error && <p className="text-xs text-red-600">{f.error}</p>}
              </div>
              <div className="shrink-0 text-xs font-medium">
                {f.status === "reading" && <span className="text-neutral-400">Reading…</span>}
                {f.status === "pending" && <span className="text-neutral-400">Ready</span>}
                {f.status === "uploading" && <span className="text-neutral-500">Uploading…</span>}
                {f.status === "done" && <span className="text-green-600">Uploaded</span>}
                {f.status === "error" && <span className="text-red-600">Failed</span>}
              </div>
              {f.status !== "uploading" && f.status !== "done" && (
                <button
                  type="button"
                  onClick={() => removeFile(f.key)}
                  aria-label={`Remove ${f.file.name}`}
                  className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
                    <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Basic metadata — applies to the whole batch */}
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-neutral-900">Basic</h2>
        <Field label="Media type" htmlFor="media_type">
          <Select id="media_type" name="media_type" defaultValue="image" required>
            {MEDIA_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {/* The editorial role. Previously absent from this form entirely, which
            meant every uploaded asset arrived with asset_role NULL and the
            library could not tell a product photograph from a diagram. */}
        <Field
          label="Editorial role"
          htmlFor="asset_role"
          hint="What this image IS. Decides how the site may use it — a concept render can never be product photography."
        >
          <Select
            id="asset_role"
            name="asset_role"
            value={assetRole}
            onChange={(e) => setAssetRole(e.target.value)}
          >
            <option value="">— not set —</option>
            {ASSET_ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        {assetRole === "concept_render" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
            <p className="text-sm font-medium text-amber-900">This will be published as a concept render.</p>
            <p className="mt-1 text-xs leading-relaxed text-amber-900/90">
              Every page using it will carry: <em>&ldquo;Concept render — not official product imagery.
              The actual hardware has not been revealed.&rdquo;</em>
            </p>
            <p className="mt-2 text-xs leading-relaxed text-amber-900/80">
              It can never become a product photograph, never counts as media coverage for a product,
              and can never be cited as evidence for a specification. Marked AI-generated automatically.
            </p>
            <input type="hidden" name="ai_generated" value="on" />
          </div>
        )}

        <Field label="Alt text" htmlFor="alt_text" hint="Describes the media for accessibility and SEO. Applied to every file in this batch — edit per-asset afterward if they need distinct alt text.">
          <TextInput id="alt_text" name="alt_text" />
        </Field>
        <Field label="Caption" htmlFor="caption">
          <TextInput id="caption" name="caption" />
        </Field>
      </div>

      {/* Advanced / Rights & provenance — collapsible */}
      <div className="rounded-lg border border-neutral-200">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-neutral-900"
          aria-expanded={advancedOpen}
        >
          Advanced / Rights &amp; provenance
          <svg
            viewBox="0 0 20 20"
            className={`h-4 w-4 text-neutral-400 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            fill="none"
            aria-hidden="true"
          >
            <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {advancedOpen && (
          <div className="flex flex-col gap-4 border-t border-neutral-200 p-4">
            <Checkbox
              id="owned"
              name="owned"
              label="Owned by Tech Carvalho (no external license needed)"
              checked={owned}
              onChange={(e) => setOwned(e.target.checked)}
            />
            {owned ? (
              <>
                <input type="hidden" name="rights_status" value="verified" />
                {/* Ticking "owned" must also record WHAT it is, not only that
                    we own it. Without this the asset arrives with source_type
                    NULL, classifies as "unclassified" rather than
                    owned_original_photo, never counts towards our own
                    photography — and shouldWatermark(), which requires
                    staff_photograph, refuses to watermark our own work. */}
                <input type="hidden" name="source_type" value="staff_photograph" />
                <input type="hidden" name="licence_permits_modification" value="true" />
                <p className="text-xs text-neutral-500">
                  Recorded as a Tech Carvalho original photograph: rights verified, modification
                  permitted, and eligible for watermarked public derivatives. You can still record
                  who made it below.
                </p>
                <Field label="Creator" htmlFor="creator" hint="Who made this, if relevant to note.">
                  <TextInput id="creator" name="creator" />
                </Field>
              </>
            ) : (
              <>
                <Field label="Source type" htmlFor="source_type">
                  <Select id="source_type" name="source_type" defaultValue="">
                    <option value="">Not specified</option>
                    {SOURCE_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Creator" htmlFor="creator" hint="Who made this — photographer, illustrator, studio.">
                  <TextInput id="creator" name="creator" />
                </Field>
                <Field label="Source URL" htmlFor="source_url" hint="Where this was sourced from, if applicable.">
                  <TextInput id="source_url" name="source_url" type="url" />
                </Field>
                <Field label="License" htmlFor="license">
                  <TextInput id="license" name="license" placeholder="e.g. CC-BY-4.0, All rights reserved" />
                </Field>
                <Field label="Attribution" htmlFor="attribution" hint="Exact text to display, if required.">
                  <Textarea id="attribution" name="attribution" rows={2} />
                </Field>
                <Checkbox id="attribution_required" name="attribution_required" label="Attribution required" />
                {/* Whether the licence permits ALTERING the image, which is a
                    different question from whether it permits reuse. CC BY-SA
                    allows reuse and says nothing about watermarking. Defaults
                    to "not assessed", which the watermark gate treats as NO —
                    unknown is never permission. */}
                <Field
                  label="Modification permitted?"
                  htmlFor="licence_permits_modification"
                  hint="Reuse permission is NOT modification permission. Leave unassessed unless the licence actually says."
                >
                  <Select id="licence_permits_modification" name="licence_permits_modification" defaultValue="">
                    <option value="">Not assessed</option>
                    <option value="true">Yes — the licence permits modification</option>
                    <option value="false">No — no-derivatives licence</option>
                  </Select>
                </Field>
                <Field
                  label="Rights status"
                  htmlFor="rights_status"
                  hint="Only Verified assets — or ones marked Owned, or a staff photograph — can be published."
                >
                  <Select id="rights_status" name="rights_status" defaultValue="unknown">
                    {RIGHTS_STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            )}
            <Checkbox id="ai_generated" name="ai_generated" label="AI-generated" />
            <Field
              label="Brand asset role"
              htmlFor="brand_role"
              hint="Leave as 'Not a brand asset' for product/article photography. Only for TechCarvalho's own logo/mark/icon files."
            >
              <Select id="brand_role" name="brand_role" defaultValue="">
                <option value="">Not a brand asset</option>
                {BRAND_ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </div>

      <p className="text-xs text-neutral-500">
        Uploads always land in the private bucket. Nothing here is publicly visible until you explicitly publish it
        from the media detail page.
      </p>

      {!batchDone ? (
        <div>
          <button
            type="submit"
            disabled={files.length === 0 || !hasUploadableFiles || isPending}
            className="rounded px-4 py-2 text-sm font-medium bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900"
          >
            {isPending
              ? "Uploading…"
              : `Upload ${files.filter((f) => f.status === "pending").length || ""} file${files.length === 1 ? "" : "s"}`}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <p className="text-sm text-neutral-700">
            {allDone
              ? "All files uploaded."
              : someFailed
                ? "Some files failed — check the list above."
                : "Batch complete."}
          </p>
          <Link href="/admin/media" className="text-sm font-medium text-accent underline">
            View media library
          </Link>
        </div>
      )}
    </form>
  );
}
