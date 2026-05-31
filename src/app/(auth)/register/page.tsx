import type { Metadata } from "next";
import { RegisterForm } from "@/components/auth/register-form";

export const metadata: Metadata = { title: "Kayıt — GuestOps AI" };

export default function RegisterPage() {
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
