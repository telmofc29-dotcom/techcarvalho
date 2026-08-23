"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { insertRow, updateRow, deleteRow, type ValidationResult } from "@/lib/admin/reference-service";
import { slugify } from "@/lib/admin/slugify";
import type {
  ProductStatus,
  SpecDataType,
  RelationshipType,
  AffiliateStatus,
  LaunchPricingCurrency,
  Insert,
} from "@/lib/types/database";
import type { FormState } from "@/components/admin/reference-form";

const VALID_STATUSES: ProductStatus[] = ["active", "discontinued", "rumored"];
const LAUNCH_PRICING_CURRENCIES: LaunchPricingCurrency[] = ["USD", "GBP", "EUR"];
// Derived from a Record keyed by the union, NOT written as an array.
//
// The array form silently narrowed: `RelationshipType[]` accepts a list of five
// when the union has eleven, so widening the union in database.ts left this
// validator rejecting six perfectly valid types with no compile error and no
// runtime error — just an admin form that quietly refuses to save. That is the
// same guard-list narrowing this project has shipped before.
//
// A Record<RelationshipType, true> cannot be short: omitting a member is a
// compile error, so adding a relationship type forces a decision here.
const RELATIONSHIP_TYPE_KEYS: Record<RelationshipType, true> = {
  successor_of: true,
  alternative_to: true,
  accessory_for: true,
  compatible_with: true,
  requires: true,
  same_family: true,
  modern_equivalent: true,
  mount_successor: true,
  requires_adapter: true,
  supports_extender: true,
  competes_with: true,
};
const VALID_RELATIONSHIP_TYPES = Object.keys(RELATIONSHIP_TYPE_KEYS) as RelationshipType[];
const VALID_AFFILIATE_STATUSES: AffiliateStatus[] = ["affiliate", "non_affiliate", "pending"];

function readProductPayload(formData: FormData): ValidationResult<Insert<"products">> {
  const name = String(formData.get("name") ?? "").trim();
  const slugInput = String(formData.get("slug") ?? "").trim();
  const manufacturerId = String(formData.get("manufacturer_id") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "").trim();
  const familyId = String(formData.get("family_id") ?? "").trim();
  const modelNumber = String(formData.get("model_number") ?? "").trim();
  const releaseDate = String(formData.get("release_date") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  const isPublished = formData.get("is_published") === "on";

  if (!name) return { error: "Name is required." };
  if (!manufacturerId) return { error: "Manufacturer is required." };
  if (!categoryId) return { error: "Category is required." };
  if (!VALID_STATUSES.includes(status as ProductStatus)) {
    return { error: "Choose a valid status." };
  }

  return {
    payload: {
      name,
      slug: slugify(slugInput || name),
      manufacturer_id: manufacturerId,
      category_id: categoryId,
      family_id: familyId || null,
      model_number: modelNumber || null,
      release_date: releaseDate || null,
      status: status as ProductStatus,
      summary: summary || null,
      is_published: isPublished,
    },
  };
}

export async function createProduct(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const result = readProductPayload(formData);
  if ("error" in result) return { error: result.error };

  let id: string;
  try {
    const row = await insertRow("products", result.payload);
    id = row.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to create product." };
  }

  revalidatePath("/admin/products");
  redirect(`/admin/products/${id}`);
}

export async function updateProduct(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const result = readProductPayload(formData);
  if ("error" in result) return { error: result.error };

  try {
    await updateRow("products", id, result.payload);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update product." };
  }

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}`);
  redirect(`/admin/products/${id}`);
}

export async function deleteProduct(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteRow("products", id);
  revalidatePath("/admin/products");
}

export async function updateProductTags(productId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const tagIds = formData.getAll("tag_id").map(String).filter(Boolean);

  const supabase = await createClient();
  const { error: deleteError } = await supabase.from("product_tags").delete().eq("product_id", productId);
  if (deleteError) throw new Error(deleteError.message);

  if (tagIds.length > 0) {
    const { error: insertError } = await supabase
      .from("product_tags")
      .insert(tagIds.map((tag_id) => ({ product_id: productId, tag_id })));
    if (insertError) throw new Error(insertError.message);
  }

  revalidatePath(`/admin/products/${productId}`);
}

export async function logProductFreshnessReview(productId: string, formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) return;

  const supabase = await createClient();
  const { error } = await supabase.from("freshness_log").insert({
    product_id: productId,
    reviewed_by: admin.id,
    reason,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/admin/freshness");
}

export async function addProductRelationship(productId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const relatedProductId = String(formData.get("related_product_id") ?? "").trim();
  const relationshipType = String(formData.get("relationship_type") ?? "").trim();

  if (!relatedProductId || relatedProductId === productId) return;
  if (!VALID_RELATIONSHIP_TYPES.includes(relationshipType as RelationshipType)) return;

  const supabase = await createClient();
  const { error } = await supabase.from("product_relationships").insert({
    product_id: productId,
    related_product_id: relatedProductId,
    relationship_type: relationshipType as RelationshipType,
  });
  // Ignore duplicate-relationship conflicts (unique constraint) rather than
  // surfacing a confusing error for re-adding the same pair/type.
  if (error && error.code !== "23505") throw new Error(error.message);

  revalidatePath(`/admin/products/${productId}`);
}

export async function deleteProductRelationship(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const productId = String(formData.get("product_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.from("product_relationships").delete().eq("id", id);
  if (error) throw new Error(error.message);

  if (productId) revalidatePath(`/admin/products/${productId}`);
}

// product_offers — "where to buy" links. See
// supabase/migrations/20260820_product_offers.sql: affiliate_status
// defaults to non_affiliate and is never auto-assumed here either — an
// admin must deliberately pick "Affiliate" for a link to render/disclose
// as one (src/lib/monetisation/affiliate.ts).
export async function addProductOffer(productId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const retailer = String(formData.get("retailer") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const affiliateStatus = String(formData.get("affiliate_status") ?? "non_affiliate").trim();
  const priceNote = String(formData.get("price_note") ?? "").trim();
  const isActive = formData.get("is_active") === "on";

  if (!retailer || !url) return;
  if (!VALID_AFFILIATE_STATUSES.includes(affiliateStatus as AffiliateStatus)) return;

  const supabase = await createClient();
  const { error } = await supabase.from("product_offers").insert({
    product_id: productId,
    retailer,
    url,
    affiliate_status: affiliateStatus as AffiliateStatus,
    price_note: priceNote || null,
    is_active: isActive,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/products/${productId}`);
}

export async function deleteProductOffer(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const productId = String(formData.get("product_id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.from("product_offers").delete().eq("id", id);
  if (error) throw new Error(error.message);

  if (productId) revalidatePath(`/admin/products/${productId}`);
}

export async function updateProductSeo(productId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const metaTitle = String(formData.get("meta_title") ?? "").trim();
  const metaDescription = String(formData.get("meta_description") ?? "").trim();
  const canonicalUrl = String(formData.get("canonical_url") ?? "").trim();
  const noindex = formData.get("noindex") === "on";

  const supabase = await createClient();
  const { error } = await supabase.from("seo_metadata").upsert(
    {
      product_id: productId,
      meta_title: metaTitle || null,
      meta_description: metaDescription || null,
      canonical_url: canonicalUrl || null,
      noindex,
    },
    { onConflict: "product_id" }
  );
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/products/${productId}`);
}

// product_launch_pricing (see
// supabase/migrations_pending/20260821_product_launch_pricing.sql — not yet
// applied to production). One form, three fixed currency slots
// (amount_USD/amount_GBP/amount_EUR etc.) rather than an arbitrary add/
// delete list, since a product has at most one row per currency by design.
// Leaving a currency's amount blank deletes any existing row for it —
// clearing a previously-sourced price should mean "we no longer have this",
// not a stale row nobody can see how to remove.
export async function updateProductLaunchPricing(productId: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();

  for (const currency of LAUNCH_PRICING_CURRENCIES) {
    const amountRaw = String(formData.get(`amount_${currency}`) ?? "").trim();

    if (!amountRaw) {
      const { error } = await supabase
        .from("product_launch_pricing")
        .delete()
        .eq("product_id", productId)
        .eq("currency", currency);
      if (error) throw new Error(error.message);
      continue;
    }

    const amount = Number(amountRaw);
    if (Number.isNaN(amount) || amount <= 0) {
      throw new Error(`${currency} launch price must be a positive number.`);
    }

    const sourceUrl = String(formData.get(`source_url_${currency}`) ?? "").trim();
    const sourcePublisher = String(formData.get(`source_publisher_${currency}`) ?? "").trim();
    const note = String(formData.get(`note_${currency}`) ?? "").trim();
    const isEstimated = formData.get(`is_estimated_${currency}`) === "on";

    const { error } = await supabase.from("product_launch_pricing").upsert(
      {
        product_id: productId,
        currency,
        amount,
        is_estimated: isEstimated,
        source_url: sourceUrl || null,
        source_publisher: sourcePublisher || null,
        note: note || null,
      },
      { onConflict: "product_id,currency" }
    );
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/admin/products/${productId}`);
}

function coerceSpecValue(dataType: SpecDataType, raw: string): unknown | undefined {
  if (dataType === "boolean") return raw === "on";
  if (raw.trim() === "") return undefined;
  if (dataType === "number") {
    const n = Number(raw);
    return Number.isNaN(n) ? undefined : n;
  }
  return raw.trim();
}

export async function updateProductSpecs(
  productId: string,
  specDefinitions: { id: string; data_type: SpecDataType }[],
  formData: FormData
): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();

  for (const def of specDefinitions) {
    const fieldName = `spec_${def.id}`;
    const raw = def.data_type === "boolean" ? (formData.get(fieldName) as string | null) ?? "" : String(formData.get(fieldName) ?? "");
    const value = coerceSpecValue(def.data_type, raw);

    if (value === undefined) {
      const { error } = await supabase
        .from("product_specs")
        .delete()
        .eq("product_id", productId)
        .eq("spec_definition_id", def.id);
      if (error) throw new Error(error.message);
      continue;
    }

    const { error } = await supabase
      .from("product_specs")
      .upsert(
        { product_id: productId, spec_definition_id: def.id, value: value as never },
        { onConflict: "product_id,spec_definition_id" }
      );
    if (error) throw new Error(error.message);
  }

  revalidatePath(`/admin/products/${productId}`);
}
