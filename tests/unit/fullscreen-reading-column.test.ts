import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// TAM EKRANDA OKUMA SÜTUNU (kurucu bildirimi, 2026-09-12 ekran görüntüsüyle:
// "burası çok uzak mesajlar arası mesafe, adam gözünü sağa sola çekmeli").
//
// 🚨 ÖLÇÜLEN KUSUR: balon genişliği `max-w-[90%] sm:max-w-[85%]` ve tam ekranda
// kap VIEWPORT'un tamamı (`fixed inset-0`). 1920px bir monitörde bu ~1630px
// demek: GELEN balon en solda, GİDEN balon en sağda başlıyor ve iki taraf
// arasında ~1000px boşluk kalıyor. Göz her mesajda soldan sağa gidip geliyor.
//
// Normal (kart) modunda sorun YOK: kart zaten grid içinde ~40rem. Yani düzeltme
// YALNIZ tam ekrana uygulanır — kart modunda sütun sınırı koymak var olan
// genişliği boşa harcardı.
//
// ⚠️ SINIR: kaydırma kabı TAM GENİŞLİKTE kalır (kaydırma çubuğu ekranın
// kenarında olmalı); sınırlanan şey İÇERİK sütunudur. Bu yüzden iddia
// `max-w-*` sınıfının İÇ sarmalayıcıda olmasını arar, kabın kendisinde değil.
// ---------------------------------------------------------------------------

const SRC = "src/components/inbox/conversation-thread.tsx";
const src = () => readFileSync(join(process.cwd(), SRC), "utf8");

describe("tam ekran — okuma sütunu", () => {
  it("🚨 tam ekranda İÇERİK sütunu sınırlı ve ORTALI", () => {
    const s = src();
    // Tek kaynak: üç yüzey (mesajlar · AI satırı · yazma alanı) AYNI sabitten
    // beslenmeli, yoksa tam ekranda sütunlar birbirini tutmaz.
    expect(s, "ortak sütun sınıfı yok").toMatch(/const readingColumnCn\s*=/);
    const m = /const readingColumnCn\s*=\s*fullscreen\s*\?\s*"([^"]+)"/.exec(s);
    expect(m, "sütun sınıfı `fullscreen` koşuluna bağlı değil").toBeTruthy();
    const cls = m![1];
    expect(cls, "ortalama yok").toContain("mx-auto");
    expect(cls, "genişlik tavanı yok").toMatch(/max-w-/);
    expect(cls, "tam genişlik tabanı yok").toContain("w-full");
  });

  it("🚨 KART modunda sütun sınırı YOK (aşırı uygulama kontrolü)", () => {
    // Kart zaten dar; orada tavan koymak yazma alanını daraltırdı.
    expect(src()).toMatch(/const readingColumnCn\s*=\s*fullscreen\s*\?\s*"[^"]+"\s*:\s*""/);
  });

  it("🚨 ÜÇ yüzeyin ÜÇÜ de aynı sütunu kullanır (mesajlar · AI satırı · yazma)", () => {
    const uses = src().match(/readingColumnCn/g) ?? [];
    // 1 tanım + 3 kullanım.
    expect(uses.length).toBe(4);
  });

  it("kaydırma KABI tam genişlikte kalır (çubuk kenarda)", () => {
    const s = src();
    const at = s.indexOf('aria-label="Mesaj geçmişi"');
    expect(at, "mesaj kabı bulunamadı").toBeGreaterThan(-1);
    // Kabın KENDİ className'i (ilk düz öznitelik) sütun sınıfını TAŞIMAZ.
    // ⚠️ `cn(...)` biçimini ELEMEK ŞART: iç sarmalayıcı hemen ardından geliyor
    // ve düz regex onu yakalayıp iddiayı yanlış katmanda ölçüyordu.
    const boxCls = /className="([^"]*)"/.exec(s.slice(at, at + 1600));
    expect(boxCls, "kabın düz className'i bulunamadı").toBeTruthy();
    expect(boxCls![1], "kap gerçekten kaydırma kabı değil").toContain("overflow-y-auto");
    expect(boxCls![1], "sütun sınırı yanlış katmanda (kapta)").not.toContain("mx-auto");
  });

  it("🚨 İÇ sarmalayıcı sütunu taşır ve dikey boşluk ORAYA taşındı", () => {
    const s = src();
    const at = s.indexOf('aria-label="Mesaj geçmişi"');
    const after = s.slice(at, at + 2200);
    // `space-y-3` kaptan iç sarmalayıcıya taşındı — kap yalnız kaydırır.
    expect(after).toMatch(/className=\{cn\("space-y-3", readingColumnCn\)\}/);
  });

  it("anti-vakum: balon genişliği kuralı GERÇEKTEN yüzdesel (kusur kurgusal değil)", () => {
    // Bu satır olmasa "sütun zaten dardı" denebilirdi: balon kabın YÜZDESİ,
    // yani kap büyüdükçe balon büyür — tam ekranda kusurun mekanizması budur.
    expect(src()).toMatch(/max-w-\[90%\]\s+sm:max-w-\[85%\]/);
  });
});
