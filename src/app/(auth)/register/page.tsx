import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Kayıt — Lixus AI" };

// Read REGISTRATION_OPEN at RUNTIME, not build time. Without this the page is
// statically prerendered and the env value is frozen at build — so flipping
// REGISTRATION_OPEN=1 later never takes effect (the page keeps redirecting).
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  // Public sign-up is closed (see the register API) — send visitors to login.
  if (process.env.REGISTRATION_OPEN !== "1") redirect("/login");

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Hesap oluşturun</h1>
        <p className="text-sm text-muted-foreground">
          İşletmenizi ekleyin ve operasyonu yönetmeye başlayın.
        </p>
      </div>
      <RegisterForm />
    </div>
  );
}
