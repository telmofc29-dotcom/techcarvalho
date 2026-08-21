import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { listRows } from "@/lib/admin/reference-service";
import { ADMIN_PAGE_SIZE, parsePage } from "@/lib/admin/pagination";
import { sanitizeSearchTerm } from "@/lib/search/sanitize";
import { PageHeader, Table, Th, Td, LinkButton, TextLink, EmptyState, Badge, QueryErrorBanner } from "@/components/admin/ui";
import { SearchBox } from "@/components/admin/search-box";
import { AdminFilterSelect } from "@/components/admin/filter-select";
import { Pagination } from "@/components/admin/pagination";
import { ConfirmDeleteButton } from "@/components/admin/submit-button";
import { deleteProduct } from "./actions";

const PUBLISH_FILTERS: { label: string; value: "" | "published" | "draft" }[] = [
  { label: "All", value: "" },
  { label: "Published", value: "published" },
  { label: "Draft", value: "draft" },
];

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; published?: string; category?: string }>;
}) {
  await requireAdmin();
  const { q: rawQ, page: rawPage, published, category } = await searchParams;
  const q = rawQ ? sanitizeSearchTerm(rawQ) : "";
  const page = parsePage(rawPage);
  const from = (page - 1) * ADMIN_PAGE_SIZE;
  const to = from + ADMIN_PAGE_SIZE - 1;

  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, to);
  if (q) query = query.or(`name.ilike.%${q}%,model_number.ilike.%${q}%`);
  if (published === "published") query = query.eq("is_published", true);
  if (published === "draft") query = query.eq("is_published", false);
  if (category) query = query.eq("category_id", category);
  const [{ data: products, count, error: productsError }, manufacturers, categories] = await Promise.all([
    query,
    listRows("manufacturers"),
    listRows("taxonomy_categories"),
  ]);
  const manufacturerName = new Map(manufacturers.map((m) => [m.id, m.name]));
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const pageCount = Math.max(1, Math.ceil((count ?? 0) / ADMIN_PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Products"
        description="The product catalog. Only published products are visible on the public site."
        action={<LinkButton href="/admin/products/new">New product</LinkButton>}
      />

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <SearchBox action="/admin/products" placeholder="Search by name or model number..." defaultValue={q} />
        <div className="flex gap-2">
          {PUBLISH_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={`/admin/products${f.value ? `?published=${f.value}` : ""}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                (published ?? "") === f.value ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <AdminFilterSelect
          label="Category"
          paramName="category"
          value={category}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          otherParams={{ q, published }}
          action="/admin/products"
        />
      </div>

      {productsError && <QueryErrorBanner message={productsError.message} />}

      {(products ?? []).length === 0 ? (
        !productsError && (
          <EmptyState
            title={q || published || category ? "No products match your filters" : "No products yet"}
            action={!q && !published && !category ? <LinkButton href="/admin/products/new">New product</LinkButton> : undefined}
          />
        )
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Manufacturer</Th>
                <Th>Category</Th>
                <Th>Status</Th>
                <Th>Published</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {(products ?? []).map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium text-neutral-900">{p.name}</Td>
                  <Td className="text-neutral-500">{manufacturerName.get(p.manufacturer_id) ?? "—"}</Td>
                  <Td className="text-neutral-500">{categoryName.get(p.category_id) ?? "—"}</Td>
                  <Td>
                    <Badge tone={p.status === "active" ? "green" : p.status === "rumored" ? "amber" : "neutral"}>
                      {p.status}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={p.is_published ? "green" : "neutral"}>{p.is_published ? "Published" : "Draft"}</Badge>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-3 justify-end">
                      <TextLink href={`/admin/products/${p.id}`}>Edit</TextLink>
                      <form action={deleteProduct}>
                        <input type="hidden" name="id" value={p.id} />
                        <ConfirmDeleteButton confirmMessage={`Delete product "${p.name}"? This removes its specs, tags, and media links.`} />
                      </form>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageCount={pageCount} basePath="/admin/products" searchParams={{ q, published, category }} />
        </>
      )}
    </div>
  );
}
