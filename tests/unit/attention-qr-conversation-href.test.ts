import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// QR SOHBETİ "MESAJLAR" SEKMESİNDE AÇILIYORDU (kurucu bildirimi, 2026-09-12:
// "normalde qr sohbeti ama ordan tıklayınca mesajlar sekmesinde açıyor sohbeti").
//
// 🚨 ÖLÇÜLEN ZİNCİR — kusur liste sayfasında DEĞİL, PANEL KISAYOLUNDAYDI:
//   · `/guest-chats` satırı DOĞRU yere gidiyor (`href={/guest-chats/${t.id}}`)
//     ve `/guest-chats/[id]` KENDİ yüzeyini çiziyor (geri düğmesi "Tüm sohbetler").
//   · `/inbox/[id]` ise kanal yüzeyidir: "← Mesajlar", "Tam ekran", "Sil", sağ
//     rayda Rezervasyon/Görevler/Bilgi Tabanı kartları.
//   · Kenar çubuğu aktifliği saf önek eşleşmesidir (`app-shell.tsx`
//     `pathname === href || pathname.startsWith(href + "/")`) → ekran
//     görüntüsünde "Mesajlar" vurguluysa pathname `/inbox/...`TİR.
//   · Inbox LİSTESİ QR'ı zaten dışlıyor (`channel: { not: "chat" }`).
//   · Geriye tek yol kalıyor: PANELDEKİ "Dikkat Gerektirenler" kartı. Buradaki
//     konuşma sorgusunda `channel` filtresi YOKTU ve href SABİT `/inbox/${id}`
//     idi — yani QR konuşması kanal yüzeyinin arkasına konuyordu.
//
// Bedeli kozmetik DEĞİL: iki yüzeyin İŞLEVLERİ farklı. QR yüzeyinde olup
// inbox'ta OLMAYANLAR: "AI yanıtlarını yeniden başlat" düğmesi · "siz
// yanıtlarsanız AI susar" ön uyarısı · "İnsan desteğinde"/"Ev sahibine
// iletildi" rozetleri · Enter=gönder. Yani host, QR sohbetini AI'ı geri
// açamadığı ve sustuğunu söylemeyen bir ekranda açıyordu.
//
// ⚠️ KAPSAM: yalnız YÖNLENDİRME düzeltiliyor. Inbox'tan QR konuşmasına yazmak
// BUGÜN DE ÇALIŞIYOR (mesaj `local` rotadan kalıcı yazılır, misafir onu
// "İşletme ekibi" olarak görür, AI duraklatması da tetiklenir) — o yol
// kapatılmadı, yalnız host artık oraya YANLIŞLIKLA düşmüyor.
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const ATTENTION = "src/modules/intelligence/incidents/attention.ts";

describe("Dikkat Gerektirenler — konuşma bağlantısı kanala göre", () => {
  it("🚨 SABİT `/inbox/` bağlantısı GERİ GELMEZ", () => {
    const s = read(ATTENTION);
    // Eski hâl: iki ayrı yerde `href: \`/inbox/${convo.id}\``.
    expect(s, "sabit inbox bağlantısı geri gelmiş").not.toMatch(
      /href:\s*`\/inbox\/\$\{convo\.id\}`/,
    );
  });

  it("🚨 sorgu KANALI çeker (eskiden alan seçilmiyordu bile)", () => {
    const s = read(ATTENTION);
    const at = s.indexOf("prisma.conversation.findMany");
    expect(at, "konuşma sorgusu bulunamadı").toBeGreaterThan(-1);
    const body = s.slice(at, at + 900);
    expect(body, "channel seçilmiyor").toMatch(/channel:\s*true/);
  });

  it("🚨 QR konuşması KENDİ yüzeyine gider", () => {
    const s = read(ATTENTION);
    expect(s).toContain("/guest-chats/");
    // Karar tek yerde: iki çağrı noktası da aynı yardımcıyı kullanmalı, yoksa
    // biri düzeltilip öteki geride kalır (bu kusurun ta kendisi).
    const helper = /function conversationHref/.test(s);
    expect(helper, "ortak yardımcı yok — iki dal ayrışabilir").toBe(true);
    const uses = s.match(/href:\s*conversationHref\(/g) ?? [];
    // Konuşmaya giden ÜÇ madde: çıkışı yaklaşan cevapsız · cevapsız · ev sahibine bırakılan istek (09-26, konuşma öğeleri).
    expect(uses.length, "her konuşma maddesi yardımcıyı kullanmalı").toBe(3);
  });

  it("anti-vakum: QR konuşmalarının kanalı GERÇEKTEN 'chat'", () => {
    // Bu satır olmadan yukarıdaki dal hiç tetiklenmeyen bir sabiti arıyor olabilirdi.
    expect(read("src/lib/guest-chat.ts")).toMatch(/channel:\s*"chat"/);
    // Ve inbox listesi aynı değerle dışlıyor — iki yüzey aynı ayrımı kullanır.
    expect(read("src/app/(app)/inbox/page.tsx")).toMatch(/channel:\s*\{\s*not:\s*"chat"\s*\}/);
  });

  it("kanal konuşmaları ESKİSİ GİBİ inbox'a gider (aşırı uygulama kontrolü)", () => {
    const s = read(ATTENTION);
    // Yardımcı yalnız "chat" için ayrışmalı; her şeyi guest-chats'e göndermek
    // simetrik ama AYNI DERECEDE yanlış bir kusur olurdu.
    const at = s.indexOf("function conversationHref");
    const body = s.slice(at, at + 600);
    expect(body).toContain("/inbox/");
    expect(body).toContain("/guest-chats/");
  });
});
