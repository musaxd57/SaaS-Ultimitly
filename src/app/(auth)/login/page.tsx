import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

// noindex: an auth form is not search content (robots.ts also disallows /login;
// this is the belt-and-braces page-level signal, like the (app) layout).
export const metadata: Metadata = {
  // Kök metadata şablonu zaten "%s · Lixus AI" ekliyor; burada markayı tekrar
  // yazmak sekmede "Giriş — Lixus AI · Lixus AI" üretiyordu.
  title: "Giriş",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Tekrar hoş geldiniz</h1>
        <p className="text-sm text-muted-foreground">
          Operasyon panelinize giriş yapın.
        </p>
      </div>
      <LoginForm />
    </div>
  );
}
