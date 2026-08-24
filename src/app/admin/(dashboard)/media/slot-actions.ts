"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getAdminPreviewUrl } from "@/lib/media/admin-preview-url";
import { planHeroAssignment } from "@/lib/media/hero-slot";
import type { MediaRole } from "@/lib/types/database";

// Media slot management driven FROM a product or article, rather than from the
// media asset.
//
// Both directions now exist deliberately. Associating from the asset answers
// "where should this picture go?"; this answers "what should illustrate this
// page?" — and the second is the one an editor actually has in mind while
// writing. Previously only the first existed, so putting a photograph on a
// product meant leaving the product, finding the asset, and working backwards.
//
// EVERY operation here is an ASSOCIATION operation. Nothing in this file
// deletes a media asset, touches a storage object, or changes a single rights,
// provenance or classification field. Removing a picture from a page means the
// page stops showing it — not that the picture is destroyed.

export type SlotActionState = {
  error: string | null;
  notice: string | null;
  /** Set when a hero assignment needs an explicit decision first. */
  heroConflict?: {
    incomingMediaId: string;
    incomingAlt: string | null;
    incomingPreviewUrl: string | null;
    currentMediaId: string;
    currentAlt: string | null;
    currentPreviewUrl: string | null;
    currentDescriptor: string;
  };
};

type Kind = "product" | "content";

function tableFor(kind: Kind) {
  return kind === "product" ? ("product_media" as const) : ("content_media" as const);
}
function columnFor(kind: Kind) {
  return kind === "product" ? ("product_id" as const) : ("content_id" as const);
}

async function readSlots(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: Kind,
  targetId: string
): Promise<{ id: string; media_id: string; role: MediaRole; sort_order: number }[]> {
  const result =
    kind === "product"
      ? await supabase.from("product_media").select("id, media_id, role, sort_order").eq("product_id", targetId)
      : await supabase.from("content_media").select("id, media_id, role, sort_order").eq("content_id", targetId);
  if (result.error) throw new Error(result.error.message);
  return (result.data ?? []) as { id: string; media_id: string; role: MediaRole; sort_order: number }[];
}

async function deleteAssociation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: Kind,
  targetId: string,
  mediaId: string,
  role?: MediaRole
) {
  if (kind === "product") {
    let q = supabase.from("product_media").delete().eq("product_id", targetId).eq("media_id", mediaId);
    if (role) q = q.eq("role", role);
    return q;
  }
  let q = supabase.from("content_media").delete().eq("content_id", targetId).eq("media_id", mediaId);
  if (role) q = q.eq("role", role);
  return q;
}

async function insertAssociation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: Kind,
  targetId: string,
  mediaId: string,
  role: MediaRole,
  sortOrder: number
) {
  const row =
    kind === "product"
      ? { product_id: targetId, media_id: mediaId, role, sort_order: sortOrder }
      : { content_id: targetId, media_id: mediaId, role, sort_order: sortOrder };
  return kind === "product"
    ? supabase.from("product_media").insert(row as never)
    : supabase.from("content_media").insert(row as never);
}

async function updateRole(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kind: Kind,
  targetId: string,
  mediaId: string,
  fromRole: MediaRole,
  toRole: MediaRole
) {
  return kind === "product"
    ? supabase
        .from("product_media")
        .update({ role: toRole })
        .eq("product_id", targetId)
        .eq("media_id", mediaId)
        .eq("role", fromRole)
    : supabase
        .from("content_media")
        .update({ role: toRole })
        .eq("content_id", targetId)
        .eq("media_id", mediaId)
        .eq("role", fromRole);
}

function describe(asset: { asset_role?: string | null; source_type?: string | null; publication_status?: string | null } | undefined) {
  if (!asset) return "unknown asset";
  const parts = [
    asset.asset_role ? asset.asset_role.replace(/_/g, " ") : "no editorial role",
    asset.source_type ? asset.source_type.replace(/_/g, " ") : "no source type",
  ];
  if (asset.publication_status !== "published") parts.push("NOT PUBLISHED - will not render publicly");
  return parts.join(" · ");
}

function revalidateFor(kind: Kind, targetId: string) {
  revalidatePath(kind === "product" ? `/admin/products/${targetId}` : `/admin/content/${targetId}`);
  revalidatePath("/admin/media");
}

/**
 * One entry point for every slot change, discriminated by `op`.
 *
 * Kept as a single action so the panel has one error channel and one confirm
 * step, rather than a dozen bare <form action> handlers that can each throw
 * into the error boundary.
 */
export async function updateTargetSlots(
  kind: Kind,
  targetId: string,
  _prev: SlotActionState,
  formData: FormData
): Promise<SlotActionState> {
  await requireAdmin();

  const op = String(formData.get("op") ?? "");
  // Every control that names an asset writes `media_id__<op>`, and we take the
  // first NON-EMPTY one.
  //
  // Three pickers and a confirmation panel share a single form. Scoping the
  // field by op stops the pickers shadowing each other; taking the first
  // non-empty value stops an emptied picker shadowing the confirmation panel's
  // hidden field, which is what made "Replace hero" appear to do nothing.
  const mediaId = formData
    .getAll(`media_id__${op}`)
    .map((v) => String(v).trim())
    .find((v) => v.length > 0) ?? "";
  const supabase = await createClient();

  try {
    const slots = await readSlots(supabase, kind, targetId);

    switch (op) {
      case "set_hero": {
        if (!mediaId) return { error: "Choose an image first.", notice: null };

        const currentHero = slots.find((s) => s.role === "hero") ?? null;
        const decision = String(formData.get("decision") ?? "");
        const plan = planHeroAssignment({
          candidateMediaId: mediaId,
          currentHeroMediaId: currentHero?.media_id ?? null,
          decision: decision === "replace" || decision === "add_to_gallery" || decision === "cancel" ? decision : undefined,
        });

        if (plan.kind === "already_hero") return { error: null, notice: "That image is already the hero." };

        if (plan.kind === "needs_decision") {
          const { data: assets } = await supabase.from("media_assets").select("*").in("id", [mediaId, plan.currentHeroMediaId]);
          const byId = new Map((assets ?? []).map((a) => [a.id, a]));
          const incoming = byId.get(mediaId);
          const current = byId.get(plan.currentHeroMediaId);
          return {
            error: null,
            notice: null,
            heroConflict: {
              incomingMediaId: mediaId,
              incomingAlt: incoming?.alt_text ?? null,
              incomingPreviewUrl: incoming ? await getAdminPreviewUrl(incoming) : null,
              currentMediaId: plan.currentHeroMediaId,
              currentAlt: current?.alt_text ?? null,
              currentPreviewUrl: current ? await getAdminPreviewUrl(current) : null,
              currentDescriptor: describe(current),
            },
          };
        }

        // Order matters: the incumbent must leave the hero slot BEFORE the
        // newcomer takes it, or the one-hero unique index rejects the insert.
        // The collision is resolved in application logic first — the database
        // constraint is a backstop, not the control flow.
        for (const operation of plan.operations) {
          if (operation.op === "demote_hero_to_gallery") {
            const existingGallery = slots.find((s) => s.media_id === operation.mediaId && s.role === "gallery");
            if (existingGallery) {
              // Already in the gallery too; just drop the hero row rather than
              // creating a duplicate gallery association.
              const { error } = await deleteAssociation(supabase, kind, targetId, operation.mediaId, "hero");
              if (error) return { error: error.message, notice: null };
            } else {
              const { error } = await updateRole(supabase, kind, targetId, operation.mediaId, "hero", "gallery");
              if (error) return { error: error.message, notice: null };
            }
          }
          if (operation.op === "set_role") {
            const existing = slots.find((s) => s.media_id === operation.mediaId);
            if (existing) {
              const { error } = await updateRole(supabase, kind, targetId, operation.mediaId, existing.role, operation.role);
              if (error) return { error: error.message, notice: null };
            } else {
              const { error } = await insertAssociation(supabase, kind, targetId, operation.mediaId, operation.role, 0);
              if (error) return { error: error.message, notice: null };
            }
          }
        }

        revalidateFor(kind, targetId);
        if (decision === "cancel") return { error: null, notice: "Left unchanged." };
        if (decision === "add_to_gallery") return { error: null, notice: "Added to the gallery. The existing hero was kept." };
        return { error: null, notice: "Hero updated. The previous hero was moved to the gallery, not deleted." };
      }

      case "set_thumbnail": {
        if (!mediaId) return { error: "Choose an image first.", notice: null };
        // An explicit thumbnail overrides the card image and MUST NOT disturb
        // the hero. Only thumbnail rows are touched here.
        const existingThumb = slots.find((s) => s.role === "thumbnail");
        if (existingThumb) {
          const { error } = await deleteAssociation(supabase, kind, targetId, existingThumb.media_id, "thumbnail");
          if (error) return { error: error.message, notice: null };
        }
        if (existingThumb?.media_id !== mediaId) {
          const { error } = await insertAssociation(supabase, kind, targetId, mediaId, "thumbnail", 0);
          if (error) return { error: error.message, notice: null };
        }
        revalidateFor(kind, targetId);
        return { error: null, notice: "Card image set. The hero is unchanged." };
      }

      case "clear_thumbnail": {
        const existingThumb = slots.find((s) => s.role === "thumbnail");
        if (!existingThumb) return { error: null, notice: "No explicit card image was set." };
        const { error } = await deleteAssociation(supabase, kind, targetId, existingThumb.media_id, "thumbnail");
        if (error) return { error: error.message, notice: null };
        revalidateFor(kind, targetId);
        return { error: null, notice: "Card image cleared. Cards now inherit the hero again." };
      }

      case "add_gallery": {
        if (!mediaId) return { error: "Choose an image first.", notice: null };
        if (slots.some((s) => s.media_id === mediaId && s.role === "gallery")) {
          return { error: null, notice: "That image is already in the gallery." };
        }
        const nextOrder = Math.max(0, ...slots.filter((s) => s.role === "gallery").map((s) => s.sort_order + 1));
        const { error } = await insertAssociation(supabase, kind, targetId, mediaId, "gallery", nextOrder);
        if (error) return { error: error.message, notice: null };
        revalidateFor(kind, targetId);
        return { error: null, notice: "Added to the gallery." };
      }

      case "remove": {
        const role = String(formData.get("role") ?? "") as MediaRole;
        if (!mediaId || !role) return { error: "Nothing selected to remove.", notice: null };
        const { error } = await deleteAssociation(supabase, kind, targetId, mediaId, role);
        if (error) return { error: error.message, notice: null };
        revalidateFor(kind, targetId);
        return {
          error: null,
          notice: "Association removed. The image itself is untouched and still in the media library.",
        };
      }

      case "move": {
        const direction = String(formData.get("direction") ?? "");
        const gallery = slots
          .filter((s) => s.role === "gallery")
          .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
        const index = gallery.findIndex((s) => s.media_id === mediaId);
        if (index === -1) return { error: "That image is not in the gallery.", notice: null };
        const swapWith = direction === "up" ? index - 1 : index + 1;
        if (swapWith < 0 || swapWith >= gallery.length) return { error: null, notice: null };

        // Rewrite the whole gallery's ordering. Cheap at this scale and it also
        // repairs any pre-existing duplicate sort_order values.
        const reordered = [...gallery];
        [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
        for (let i = 0; i < reordered.length; i++) {
          const row = reordered[i];
          const update =
            kind === "product"
              ? await supabase.from("product_media").update({ sort_order: i }).eq("id", row.id)
              : await supabase.from("content_media").update({ sort_order: i }).eq("id", row.id);
          if (update.error) return { error: update.error.message, notice: null };
        }
        revalidateFor(kind, targetId);
        return { error: null, notice: null };
      }

      default:
        return { error: "Unknown operation.", notice: null };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Slot update failed.", notice: null };
  }
}
