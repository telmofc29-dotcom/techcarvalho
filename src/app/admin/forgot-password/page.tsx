import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <ForgotPasswordForm />
      <Link href="/admin/login" className="text-sm text-neutral-600 underline">
        Back to sign in
      </Link>
    </main>
  );
}
