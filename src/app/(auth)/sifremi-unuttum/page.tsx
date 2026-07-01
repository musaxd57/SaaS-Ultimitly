import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Şifremi unuttum — Lixus AI" };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Şifreni mi unuttun?</h1>
        <p className="text-sm text-muted-foreground">
          E-postana bir doğrulama kodu gönderelim; yeni şifreni hemen belirle.
        </p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
