"use client";

import { useRef, useState, useTransition, type DragEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { Field, TextInput, Textarea, Select, Checkbox } from "@/components/admin/ui";
import { createMediaUploadTicket, finaliseMediaUpload } from "./actions";
import { createClient } from "@/lib/supabase/client";
import { MEDIA_PRIVATE_BUCKET } from "@/lib/media/constants";
import { CLASSIFICATION_PRESETS, type ClassificationPresetId } from "@/lib/media/classification-presets";
import {
  ACCEPTED_FORMATS_LABEL,
  ACCEPTED_IMAGE_TYPES,
  ACCEPTED_VIDEO_TYPES,
  MAX_UPLOAD_BYTES,
  checkUploadCandidate,
  formatBytes,
} from "@/lib/media/upload-limits";
// Rendered from the same module the server action validates against, so a menu
// entry the server would refuse cannot exist. See src/lib/media/form-options.ts.
import {
  ASSET_ROLE_OPTIONS,
  BRAND_ROLE_OPTIONS,
  MEDIA_TYPE_OPTIONS,
  RIGHTS_STATUS_OPTIONS,
  SOURCE_TYPE_OPTIONS,
} from "@/lib/media/form-options";

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
  const [preset, setPreset] = useState<ClassificationPresetId | "">("");
  // Ownership is no longer a checkbox of its own: it follows from the answer
  // to "where did these come from?", which is the question the owner can
  // actually answer.
  const chosenPreset = CLASSIFICATION_PRESETS.find((p) => p.id === preset) ?? null;
  const owned = chosenPreset?.patch.owned === true;
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
      // Checked BEFORE anything leaves the browser. Previously an oversized
      // file was sent anyway and died inside a Server Action as
      // "Body exceeded 1 MB limit" (413), which React masked as #441 — an
      // unexplained red box instead of a sentence naming the size and the
      // limit. Same validator the server re-runs when issuing the ticket.
      const verdict = checkUploadCandidate({
        name: entry.file.name,
        size: entry.file.size,
        type: entry.file.type,
      });
      const mediaType = verdict.ok ? verdict.mediaType : null;
      const error: string | null = verdict.ok ? null : verdict.error;

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

  // THREE STEPS PER FILE, and the bytes never touch a Vercel function:
  //
  //   1. Ask the server to authorise ONE upload. It checks admin, re-validates
  //      size and type, generates the storage path itself, and returns a signed
  //      token scoped to that exact path.
  //   2. Send the file straight from the browser to Supabase Storage. This is
  //      what makes a 20 MB original possible at all — Vercel rejects any
  //      function request body over 4.5 MB with a 413, so no framework setting
  //      could have carried the file through a Server Action.
  //   3. Ask the server to record it. The server confirms the object really
  //      exists before writing a row, so a record can never claim an upload
  //      that did not land.
  function uploadBatch(formEl: HTMLFormElement) {
    const sharedData = new FormData(formEl);
    const uploadable = files.filter((f) => f.status === "pending" || f.status === "error");
    const storage = createClient().storage.from(MEDIA_PRIVATE_BUCKET);

    startTransition(async () => {
      for (const entry of uploadable) {
        setFiles((prev) => prev.map((f) => (f.key === entry.key ? { ...f, status: "uploading", error: null } : f)));

        const fail = (message: string) =>
          setFiles((prev) =>
            prev.map((f) => (f.key === entry.key ? { ...f, status: "error", error: message } : f))
          );

        const ticket = await createMediaUploadTicket(entry.file.name, entry.file.type, entry.file.size);
        if (ticket.error || !ticket.path || !ticket.token) {
          fail(ticket.error ?? "Could not authorise the upload.");
          continue;
        }

        const { error: uploadError } = await storage.uploadToSignedUrl(ticket.path, ticket.token, entry.file, {
          contentType: entry.file.type || undefined,
        });
        if (uploadError) {
          fail(`Upload failed: ${uploadError.message}`);
          continue;
        }

        const perFile = new FormData();
        for (const [key, value] of sharedData.entries()) perFile.append(key, value);
        perFile.set("storage_path", ticket.path);
        if (entry.width) perFile.set("width", String(entry.width));
        if (entry.height) perFile.set("height", String(entry.height));

        const result = await finaliseMediaUpload(perFile);

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
  const someFailed = files.some((f) => f.status === "error" && !f.error?.startsWith("Unsupported") && !f.error?.startsWith("This file is"));

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
        <p className="text-xs text-neutral-500">Accepted formats: {ACCEPTED_FORMATS_LABEL}</p>
        <p className="text-xs text-neutral-500">
          Maximum original size: <strong className="font-semibold">{formatBytes(MAX_UPLOAD_BYTES)}</strong> per file
        </p>
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
                <p className="text-xs text-neutral-500">
                  {formatBytes(f.file.size)}
                  {f.width != null && f.height != null ? ` · ${f.width} × ${f.height} px` : ""}
                  {f.status === "reading" ? " · reading…" : ""}
                </p>
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

      {/* Where did these files come from? Asked BEFORE upload, because the
          answer decides whether anything else is even required — and because a
          batch of our own renders arriving as "unknown" was the single biggest
          source of unusable media in the library. */}
      <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Where did these files come from?</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Applies to every file in this batch; you can change any of them individually afterwards. For anything
            TechCarvalho made this is the only classification needed. Nothing here invents a source, licence or
            creator for someone else&apos;s work.
          </p>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Batch source</legend>
          {CLASSIFICATION_PRESETS.map((option) => (
            <label
              key={option.id}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                preset === option.id ? "border-neutral-900 bg-neutral-50" : "border-neutral-200 bg-white"
              }`}
            >
              <input
                type="radio"
                name="__batch_preset"
                value={option.id}
                checked={preset === option.id}
                onChange={() => {
                  setPreset(option.id);
                  // Drive the visible Editorial role select rather than
                  // shadowing it with a hidden field — otherwise choosing a
                  // preset would silently override a role the owner then picked
                  // by hand, with no indication which had won.
                  if (option.patch.asset_role) setAssetRole(option.patch.asset_role);
                }}
                className="mt-1"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-neutral-900">{option.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-neutral-600">{option.help}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {/* Only legitimate, asserted facts travel with the batch. */}
        {chosenPreset?.patch.owned === true && <input type="hidden" name="owned" value="on" />}
        {chosenPreset?.patch.source_type && (
          <input type="hidden" name="source_type" value={chosenPreset.patch.source_type} />
        )}
        {chosenPreset?.patch.rights_status && (
          <input type="hidden" name="rights_status" value={chosenPreset.patch.rights_status} />
        )}
        {/* asset_role is applied to the visible select above, not hidden here.
            ai_generated for a concept render is emitted by the concept-render
            notice itself, which is also where the consequences are explained. */}

        {chosenPreset?.requiresManualProvenance && (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            External media needs its real source URL, licence and creator. Open Advanced below and enter them, or
            upload now and add them per asset afterwards — it stays private until they are recorded.
          </p>
        )}
      </div>

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
            {/* Ownership, source type and rights now come from the batch
                classification above, so this panel no longer offers a second,
                conflicting way to set them. It carries the fields that are only
                ever needed for someone else's work. */}
            {owned ? (
              <>
                <input type="hidden" name="licence_permits_modification" value="true" />
                <p className="text-xs text-neutral-500">
                  Classified above as TechCarvalho-owned: rights verified, modification permitted, and eligible for
                  watermarked public derivatives. You can still record who made it.
                </p>
                <Field label="Creator" htmlFor="creator" hint="Who made this, if relevant to note.">
                  <TextInput id="creator" name="creator" />
                </Field>
              </>
            ) : (
              <>
                {!chosenPreset?.patch.source_type && (
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
                )}
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

      <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-xs leading-relaxed text-neutral-600">
        <p>
          <strong className="font-semibold text-neutral-800">Your original is kept, untouched.</strong> The file you
          upload is stored byte-for-byte as the private master. It is never resized, re-encoded or compressed.
        </p>
        <p className="mt-1">
          Public, web-sized versions are separate derivatives generated later from that master — publishing one never
          alters or replaces the original.
        </p>
        <p className="mt-1">
          Uploads always land in the private bucket. Nothing here is publicly visible until you explicitly publish it
          from the media detail page.
        </p>
      </div>

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
