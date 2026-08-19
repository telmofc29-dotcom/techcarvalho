"use client";

import { useActionState } from "react";
import { Field, TextInput, Select } from "@/components/admin/ui";
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
      <div className="grid grid-cols-2 gap-4">
        <Field label="Width (px)" htmlFor="width">
          <TextInput id="width" name="width" type="number" />
        </Field>
        <Field label="Height (px)" htmlFor="height">
          <TextInput id="height" name="height" type="number" />
        </Field>
      </div>
      <Field label="License" htmlFor="license">
        <TextInput id="license" name="license" placeholder="e.g. CC-BY-4.0, All rights reserved" />
      </Field>
      <Field label="Attribution" htmlFor="attribution">
        <TextInput id="attribution" name="attribution" />
      </Field>
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
