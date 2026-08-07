import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// PANEL 404 — kabuğun İÇİNDE kalır (denetim 08-07 (4)).
//
// 🚨 SORUN: `notFound()` üç yerden çağrılıyor (`inbox/[id]`, `properties/[id]`,
// `guest-chats/[id]`) ve bu dosya YOKKEN kök `src/app/not-found.tsx`e düşüyordu.
// O sayfa `(app)/layout.tsx`in DIŞINDA render olur: kenar çubuğu kaybolur ve tek
// çıkış düğmesi `href="/"` ile kullanıcıyı PAZARLAMA SİTESİNE atar. Silinmiş bir
// konuşma bağlantısına tıklayan ev sahibi kendini ürünün dışında buluyordu.
//
// Bu, `(app)/error.tsx`in yazılma sebebinin birebir aynısı ("oradan panele dönüş
// yolu yoktu") — hata dalı için çözülmüş, 404 dalı için unutulmuştu.
//
// ⚠️ Bu dosya `(app)` grubunda olduğu için layout ÇALIŞIR: kabuk, kenar çubuğu ve
// karanlık mod kapsamı (`ThemeScope` zaten kökte) korunur. Sayfanın kendi
// "ana sayfa" bağlantısı YOKTUR — panelin içindeyiz, doğru hedef panodur.
// ---------------------------------------------------------------------------

export default function PanelNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-20 text-center">
      <div className="space-y-2">
        <p className="text-5xl font-bold tracking-tight text-primary">404</p>
        <h1 className="text-xl font-semibold">Bu kayıt bulunamadı</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Aradığınız kayıt silinmiş olabilir ya da bağlantı artık geçerli değil.
          Menüden devam edebilirsiniz.
        </p>
      </div>
      <Link href="/dashboard" className={cn(buttonVariants())}>
        <ArrowLeft className="size-4" /> Panele dön
      </Link>
    </div>
  );
}
