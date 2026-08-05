import type { Metadata } from "next";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";

// Marka kök şablondan gelir ("%s · Lixus AI") — burada tekrarlanmaz.
export const metadata: Metadata = { title: "E-posta doğrulama" };

export default function VerifyEmailPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">E-posta doğrulama</h1>
        <p className="text-sm text-muted-foreground">
          E-postandaki bağlantıyı açtın; hesabını doğruluyoruz.
        </p>
      </div>
      <VerifyEmailForm />
    </div>
  );
}
