import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// QR MİSAFİR SOHBETLERİ — HOST PANELİ YÜZEY PİNLERİ (kurucu, 2026-09-11).
//
// ⚠️ Bunlar KAYNAK TARAMASI pinleridir ve tek yönlüdür: "sınıf/ bileşen orada
// mı" sorusunu yanıtlar, davranışı DEĞİL. Gerekçe: bu iki sayfa SUNUCU
// bileşenidir (`"use client"` yok, `prisma` ve `requireAuth` çağırıyor), jsdom
// içinde çizilemez. Davranışı ölçülebilen parçalar AYRI ve DAVRANIŞSAL pinli:
// yazma kutusu `tests/ui/guest-chat-reply-warning.test.tsx`, otomatik yenileme
// bileşeninin kendisi `tests/ui/auto-refresh.test.tsx`.
//
// Bu dosyanın işi, kurucunun İKİ KEZ bildirdiği kusur sınıfının sessizce geri
// gelmesini engellemektir: "kart/bileşen kaldırıldı ve kimse fark etmedi".
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
/** Yorumları eler — pin ÇİZİLEN çıktıyı ölçer, dosyadaki açıklama metnini değil.
 *  (Bu turun kendi yorumu kaldırdığı emojileri ADIYLA anıyor; onsuz pin kendi
 *  açıklamasına takılıyordu.) */
const code = (rel: string) =>
  read(rel)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");
const LIST = "src/app/(app)/guest-chats/page.tsx";
const DETAIL = "src/app/(app)/guest-chats/[id]/page.tsx";

describe("QR sohbet ekranları — canlı yenileme", () => {
  it("🚨 HER İKİ ekran da AutoRefresh çiziyor (ekran kendini yenilemiyordu)", () => {
    for (const rel of [LIST, DETAIL]) {
      const src = read(rel);
      expect(src, rel).toContain('from "@/components/inbox/auto-refresh"');
      expect(src, rel).toMatch(/<AutoRefresh\s+seconds=\{30\}\s*\/>/);
    }
  });

  it("anti-vakum: kanonik emsal (Mesajlar) hâlâ aynı bileşeni kullanıyor", () => {
    // Bu satır olmadan, bileşen tamamen silinse bile yukarıdaki iddia yalnız
    // "metin var" derdi. Emsal kırılırsa taramanın dayanağı da kalmaz.
    expect(read("src/app/(app)/inbox/page.tsx")).toMatch(/<AutoRefresh\s+seconds=\{30\}\s*\/>/);
  });
});

describe("QR sohbet detayı — kaydırma kabı", () => {
  const src = () => read(DETAIL);

  it("🚨 mesajlar KENDİ kaydırma kabında (eskiden tüm pencere düz basılıyordu)", () => {
    const s = src();
    expect(s).toContain("MESSAGE_BOX_ID");
    // Gelen kutusundaki desenin aynısı: yükseklik + kaydırma + zincirleme yok.
    expect(s).toMatch(/max-h-\[52vh\][^"]*overflow-y-auto/);
    expect(s).toContain("overscroll-contain");
    // Kaydırma çubuğu GÖRÜNÜR sınıfını taşır (kurucu: "çok silik").
    expect(s).toContain("scrollbar-thin");
  });

  it("🚨 yazma kutusu kabın DIŞINDA — yeni mesaj onu aşağı itemez", () => {
    const s = src();
    const boxOpen = s.indexOf(`id={MESSAGE_BOX_ID}`);
    const boxClose = s.indexOf("<ScrollToLatest");
    const composer = s.indexOf("<GuestChatReply");
    expect(boxOpen, "kaydırma kabı bulunamadı").toBeGreaterThan(-1);
    expect(boxClose, "ScrollToLatest bulunamadı").toBeGreaterThan(boxOpen);
    expect(composer, "yazma kutusu kabın içinde kalmış").toBeGreaterThan(boxClose);
  });

  it("açılışta en son mesaja konumlanır", () => {
    const s = src();
    expect(s).toContain('from "@/components/guest-chats/scroll-to-latest"');
    expect(s).toMatch(/targetId=\{MESSAGE_BOX_ID\}/);
    // İmza sayıya DEĞİL, sayı + son mesaj kimliğine bakar.
    expect(s).toMatch(/latestSignature\s*=\s*`\$\{convo\._count\.messages\}:/);
  });

  it("yazma kutusuna devir durumu GEÇİLİR (uyarı metni doğru seçilsin)", () => {
    expect(src()).toMatch(/<GuestChatReply[^>]*aiPaused=\{aiPaused\}/);
  });
});

describe("QR sohbet ekranları — ikonlar", () => {
  it("🚨 EMOJİ KALMADI: 🤖 / 👤 / 🙋 üç yüzeyden de çıktı", () => {
    // Emoji sistem yazı tipine bağlıydı (Android/iOS/Windows'ta farklı çizim,
    // tema rengini almıyor). Kurucu: "AI logosunda adam gibi bir logo olsun
    // robot niye koydun".
    for (const rel of [LIST, DETAIL]) {
      const s = code(rel);
      expect(s, `${rel} robot emoji`).not.toContain("\u{1F916}");
      expect(s, `${rel} misafir emoji`).not.toContain("\u{1F464}");
      expect(s, `${rel} el kaldıran emoji`).not.toContain("\u{1F64B}");
      // Anti-vakum: yorum eleyici dosyayı boşaltmadı.
      expect(s.length, rel).toBeGreaterThan(500);
    }
  });

  it("🚨 AI'ın yüzü ÜRÜNÜN KENDİ LOGOSU (BrandMark) — robot ikonu değil", () => {
    const s = read(DETAIL);
    expect(s).toContain('from "@/components/brand"');
    expect(s).toContain("<BrandMark");
    // Anti-vakum + aşırı uygulama kontrolü: misafir ve host rolleri AYRI
    // ikonlar aldı, hepsi logoya çevrilmedi.
    expect(s).toMatch(/<User className=/);
    expect(s).toMatch(/<UserRound className=/);
  });
});
