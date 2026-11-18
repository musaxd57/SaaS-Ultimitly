import { redirect } from "next/navigation";
import { requireManagerSession } from "@/lib/auth/manager-page";

// "Yeni konuşma" formu KALDIRILDI (kurucu 11-18 akşam: "Lixus misafir konuşması uydurmaz. Konuşma ya kanaldan gelir ya QR'dan." — tasarım
// `docs/TASARIM-2026-11-18-gercek-konusma-ve-ic-not.md` D2). Adres eski yer imleri 404 vermesin diye durur ve Gelen Kutusu'na yönlendirir.
// Personel kapısı önce koşar (personel `/tasks`'a gider — öteki uygulama sayfalarıyla aynı kural, `manager-page-gate.test.ts`).
export const dynamic = "force-dynamic";

export default async function NewConversationPage() {
  await requireManagerSession();
  redirect("/inbox");
}
