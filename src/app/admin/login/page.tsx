import { LoginForm } from "./login-form";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-xl font-semibold">Tech Carvalho Admin</h1>
      <LoginForm next={next && next.startsWith("/admin") ? next : "/admin"} />
    </main>
  );
}
