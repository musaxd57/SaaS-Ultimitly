import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

// Marka kök şablondan gelir ("%s · Lixus AI") — burada tekrarlanmaz.
export const metadata: Metadata = { title: "Şifremi unuttum" };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Şifrenizi mi unuttunuz?</h1>
        <p className="text-sm text-muted-foreground">
          E-posta adresinize bir sıfırlama kodu gönderelim, ardından yeni şifrenizi oluşturun.
        </p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
