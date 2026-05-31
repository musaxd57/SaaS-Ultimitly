import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Giriş — GuestOps AI" };

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
