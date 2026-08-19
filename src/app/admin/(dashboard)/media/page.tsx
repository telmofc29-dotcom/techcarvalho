import Image from "next/image";
import Link from "next/link";
import { requireAdmin } from "@/lib/dal";
import { listRows } from "@/lib/admin/reference-service";
import { mediaPublicUrl } from "@/lib/media/public-url";
import { PageHeader, LinkButton, EmptyState, Badge } from "@/components/admin/ui";

export default async function MediaListPage() {
  await requireAdmin();
  const media = await listRows("media_assets", { orderBy: "created_at", ascending: false });

  return (
    <div>
      <PageHeader
        title="Media"
        description="Images and video referenced by products and content."
        action={<LinkButton href="/admin/media/new">Upload media</LinkButton>}
      />

      {media.length === 0 ? (
        <EmptyState
          title="No media uploaded yet"
          action={<LinkButton href="/admin/media/new">Upload media</LinkButton>}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {media.map((m) => (
            <Link key={m.id} href={`/admin/media/${m.id}`}>
              <div className="rounded-lg border border-neutral-200 bg-white overflow-hidden hover:border-neutral-400">
                <div className="aspect-video bg-neutral-100 relative flex items-center justify-center">
                  {m.media_type === "image" ? (
                    <Image
                      src={mediaPublicUrl(m.storage_path)}
                      alt={m.alt_text ?? ""}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  ) : (
                    <span className="text-xs text-neutral-500">Video</span>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs text-neutral-700 truncate">{m.storage_path.split("/").pop()}</p>
                  <Badge>{m.media_type}</Badge>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
