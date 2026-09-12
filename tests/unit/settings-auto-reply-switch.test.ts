import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// OTO-YANIT ANAHTARI AYARLAR'DA + ÜÇ YANLIŞ İPUCU (kurucu sorusu, 2026-09-12:
// "ayarlara aldın dimi otonom mesajlaşmayı ve o kapalıysa ama gene de giriş
// çıkış mesajları açılabiliyor mu?").
//
// 🚨 KODDA ÖLÇÜLEN İKİ GERÇEK:
//
// ① Ana anahtar `autoReplyHospitable` AYARLAR'DA HİÇ YOKTU (0 geçiş) — yalnız
//    Mesajlar (inbox) sayfasının üstünde. Panel onboarding'i host'u
//    `/settings`e gönderiyor ve anahtar orada olmadığı için ÇIKMAZ SOKAK.
//
// ② Üç yaşam-döngüsü göndericisi (`sendDueWelcomes` · `sendDueCheckins` ·
//    `sendDueCheckouts`) `autoReplyHospitable` alanını SELECT ETMİYOR bile;
//    her biri YALNIZ kendi anahtarına bakıyor (`autoWelcome`/`autoCheckin`/
//    `autoCheckout`). Yani ana anahtar KAPALIYKEN bile bu üç mesaj GİDER.
//    Ana anahtar yalnız `applyChannelAutoReply` (misafir mesajına AI cevabı)
//    ve onun toplu koşucusunda okunuyor.
//
// 🚨 Buna rağmen Ayarlar'daki ÜÇ İPUCU da "Ana şalter de açık olmalı" /
//    "Güvenlik ana şalteri de açık olmalı" diyordu — ÜÇÜ DE YANLIŞ. Host
//    "hepsini kapattım" sanıp misafire mesaj gitmeye devam ediyordu.
//
// KARAR (davranış DEĞİŞMEZ, yalnız ad ve görünürlük):
//  · Üç lifecycle mesajı modelden HİÇ geçmez — host'un Bilgi Tabanı'na yazdığı
//    metin aynen gider. Onları AI anahtarına BAĞLAMAK yanlış olurdu: AI'ı
//    kapatmak host'un kendi karşılama metnini durdurmak için sebep değil.
//  · Alt anahtarlar UI'da KİLİTLENMEZ: sunucu tarafında böyle bir kapı yok,
//    kilit YALAN söyler ve canlı org'ları sessizce durdurma riski taşır.
//  · Çözüm DÜRÜST AD + DÜRÜST İPUCU + kaynağın yazılması.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const SETTINGS = "src/app/(app)/settings/page.tsx";
const AUTOMATION = "src/lib/automation.ts";

/**
 * YORUMSUZ kaynak. 🚨 Bu helper olmadan "yanlış ipucu kalktı" iddiası KENDİ
 * BELGESİNE takılıyor: düzeltmenin JSX yorumu eski yanlış cümleyi ("Ana şalter
 * de açık olmalı") ADIYLA anlatmak ZORUNDA, yoksa bir sonraki okuyucu neyin
 * neden değiştiğini bilemez. Aynı ders bu turda üçüncü kez çıktı.
 *
 * ⚠️ `{/* … *\/}` JSX yorumları da elenir — `/* … *\/` bloğu onları da kapsar.
 */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//"))
    .join("\n");

describe("Ayarlar — AI ana anahtarı", () => {
  it("🚨 `autoReplyHospitable` AYARLAR'DA var (eskiden 0 geçiş)", () => {
    const s = read(SETTINGS);
    expect(s).toContain('field="autoReplyHospitable"');
    expect(s).toMatch(/enabled=\{org\?\.autoReplyHospitable/);
    // Sorgu alanı da seçilmeli, yoksa anahtar hep kapalı görünür.
    expect(s).toMatch(/autoReplyHospitable:\s*true/);
  });

  it("🚨 AD DÜRÜST: ne yaptığını söyler (AI, misafir mesajına cevap)", () => {
    const s = read(SETTINGS);
    // "Otomatik yanıt" host'a "her otomatik mesaj" diye okunuyordu.
    expect(s).toMatch(/AI misafir mesajlarını yanıtlasın/);
  });

  it("🚨 ÜÇ YANLIŞ İPUCU KALKTI ('ana şalter de açık olmalı')", () => {
    const s = code(SETTINGS);
    // Anti-vakum: yorum soyma dosyayı boşaltmadı.
    expect(s.length, "yorum soyma dosyayı boşaltmış").toBeGreaterThan(5000);
    expect(s, "yanlış ana-şalter iddiası duruyor").not.toMatch(/[Aa]na şalter(i)? de açık olmalı/);
    expect(s).not.toMatch(/Güvenlik ana şalteri de açık olmalı/);
    // ⚠️ `AUTO_REPLY_ENABLED` bandı AYRI ve DÜRÜST: o env şalteri üç göndericiyi
    // GERÇEKTEN kapatıyor (ölçüldü: üçünde de okunuyor). Silinmedi, pinlendi.
    expect(s, "env şalteri bandı kaybolmuş").toContain("Otomatik gönderim ana şalteri");
  });

  it("🚨 BAĞIMSIZLIK AÇIKÇA YAZILI (host 'hepsini kapattım' sanmasın)", () => {
    const s = read(SETTINGS);
    expect(s).toMatch(/bu üç mesaj.*bağımsız|AI anahtarından BAĞIMSIZ|AI anahtarından bağımsız/i);
  });

  it("🚨 KAYNAK yazılı: üç mesaj Bilgi Tabanı'ndan gelir", () => {
    const s = read(SETTINGS);
    // Host "bu metni nereden değiştiririm" sorusunun cevabını ekranda görmeli.
    expect(s).toContain("/knowledge");
  });

  it("alt anahtarlar KİLİTLENMEDİ (salt-UI kilit yalan söyler)", () => {
    const s = read(SETTINGS);
    // `locked` yalnız ABONELİK kapısıdır (`automationLocked`); ana anahtara
    // bağlı yeni bir kilit EKLENMEDİ.
    expect(s).not.toMatch(/locked=\{[^}]*autoReplyHospitable/);
  });
});

describe("anti-vakum — iddiaların dayandığı KOD gerçeği", () => {
  it("üç gönderici ana anahtarı GERÇEKTEN okumuyor (kusur kurgusal değil)", () => {
    const s = read(AUTOMATION);
    for (const [fn, own] of [
      ["sendDueWelcomes", "autoWelcome"],
      ["sendDueCheckins", "autoCheckin"],
      ["sendDueCheckouts", "autoCheckout"],
    ] as const) {
      const at = s.indexOf(`export async function ${fn}`);
      expect(at, `${fn} bulunamadı`).toBeGreaterThan(-1);
      const body = s.slice(at, at + 2000);
      expect(body, `${fn} kendi anahtarını okumuyor`).toContain(`org.${own}`);
      expect(body, `${fn} artık ana anahtarı okuyor — belge/ipucu güncellensin`).not.toContain(
        "autoReplyHospitable",
      );
    }
  });

  it("ana anahtar AI cevap yolunda GERÇEKTEN kapı (iddia tek yönlü değil)", () => {
    expect(read(AUTOMATION)).toMatch(/!org\.autoReplyHospitable/);
  });
});
