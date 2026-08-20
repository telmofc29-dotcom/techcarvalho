import { requireAdmin } from "@/lib/dal";
import { AdminNav } from "@/components/admin/admin-nav";
import { signOut } from "../actions";

export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      <a
        href="#admin-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-neutral-900 focus:px-4 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-4">
        <span className="font-semibold text-neutral-900">Tech Carvalho Admin</span>
        <div className="flex items-center gap-4 text-sm text-neutral-600">
          <span>{admin.display_name ?? admin.email}</span>
          <form action={signOut}>
            <button
              type="submit"
              className="underline hover:text-neutral-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 rounded"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <div className="flex flex-col md:flex-row flex-1">
        <AdminNav />
        <main id="admin-main-content" className="flex-1 p-6 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
