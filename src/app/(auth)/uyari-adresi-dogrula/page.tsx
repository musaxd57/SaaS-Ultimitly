import type { Metadata } from "next";
import { AlertEmailVerifyForm } from "@/components/auth/alert-email-verify-form";

// Marka kök şablondan gelir ("%s · Lixus AI") — burada tekrarlanmaz.
export const metadata: Metadata = { title: "Uyarı adresi onayı", robots: { index: false, follow: false } };

/** Doğrulama e-postasındaki bağlantının açtığı sayfa (kurucu kararı 09-30). Oturum gerekmez: alıcı ekip dışı olabilir. */
export default function AlertEmailVerifyPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Uyarı adresini onaylayın</h1>
      </div>
      <AlertEmailVerifyForm />
    </div>
  );
}
