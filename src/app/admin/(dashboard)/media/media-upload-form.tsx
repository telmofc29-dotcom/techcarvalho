"use client";

import { useActionState } from "react";
import { Field, TextInput, Textarea, Select, Checkbox } from "@/components/admin/ui";
import { SubmitButton } from "@/components/admin/submit-button";
import { uploadMediaAsset } from "./actions";
import type { FormState } from "@/components/admin/reference-form";

const initialState: FormState = { error: null };

export function MediaUploadForm() {
  const [state, formAction] = useActionState(uploadMediaAsset, initialState);

  return (
    <form action={formAction} encType="multipart/form-data" className="flex flex-col gap-4 max-w-xl">
      <Field label="File" htmlFor="file">
        <input id="file" name="file" type="file" required className="text-sm" />
      </Field>
      <Field label="Media type" htmlFor="media_type">
        <Select id="media_type" name="media_type" defaultValue="image" required>
          <option value="image">Image</option>
          <option value="video">Video</option>
        </Select>
      </Field>
      <Field label="Alt text" htmlFor="alt_text" hint="Describes the media for accessibility and SEO.">
        <TextInput id="alt_text" name="alt_text" />
      </Field>
      <Field label="Caption" htmlFor="caption">
        <TextInput id="caption" name="caption" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Width (px)" htmlFor="width">
          <TextInput id="width" name="width" type="number" />
        </Field>
        <Field label="Height (px)" htmlFor="height">
          <TextInput id="height" name="height" type="number" />
        </Field>
      </div>
      <Field label="Source type" htmlFor="source_type">
        <Select id="source_type" name="source_type" defaultValue="">
          <option value="">Not specified</option>
          <option value="manufacturer">Manufacturer</option>
          <option value="staff_photograph">Staff photograph</option>
          <option value="stock_licensed">Stock (licensed)</option>
          <option value="user_submitted">User submitted</option>
          <option value="press_kit">Press kit</option>
          <option value="other">Other</option>
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
      <div className="flex flex-col gap-2">
        <Checkbox id="attribution_required" name="attribution_required" label="Attribution required" />
        <Checkbox id="ai_generated" name="ai_generated" label="AI-generated" />
        <Checkbox id="owned" name="owned" label="Owned by Tech Carvalho (no external license needed)" />
      </div>
      <Field
        label="Rights status"
        htmlFor="rights_status"
        hint="Only Verified assets — or ones marked Owned, or a staff photograph — can be published."
      >
        <Select id="rights_status" name="rights_status" defaultValue="unknown">
          <option value="unknown">Unknown</option>
          <option value="pending_verification">Pending verification</option>
          <option value="verified">Verified</option>
          <option value="restricted">Restricted (never publish)</option>
        </Select>
      </Field>
      <p className="text-xs text-neutral-500">
        Uploads always land in the private bucket. Nothing here is publicly visible until you explicitly publish
        it from the media detail page.
      </p>
      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <div>
        <SubmitButton pendingLabel="Uploading...">Upload</SubmitButton>
      </div>
    </form>
  );
}
