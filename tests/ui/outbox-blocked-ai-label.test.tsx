// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { SKIP_REASON_LABELS } from "@/lib/inbox-skip-labels";

// Tur 7 T7-OB-4 (kurucu 11-05 "tamamını yap"): engellenen YAPAY ZEKÂ cevabı abonelik dönünce iptal edilir (W7) — ekranlar "gönderilecek /
// yeniden denenecek" demez. Ev sahibinin kendi mesajı ve otomatik mesajlar için eski (doğru) metin kalır.
describe("abonelik pasif — yapay zekâ cevabı için dürüst metin", () => {
  const thread = readFileSync("src/components/inbox/conversation-thread.tsx", "utf8");
  const queue = readFileSync("src/app/(app)/sent/queue/page.tsx", "utf8");

  it("konuşma balonu: yapay zekâ cevabında 'gönderilmeyecek', diğerlerinde eski metin", () => {
    expect(thread).toMatch(/m\.outboxStatus === "blocked" && m\.authorType === "ai" \? BLOCKED_AI_LABEL/);
    expect(thread).toContain('const BLOCKED_AI_LABEL = "Abonelik pasif — bu cevap gönderilmeyecek";');
    expect(thread).toContain("Abonelik pasif — bağlantı gelince gönderilecek");
  });

  it("gönderim kuyruğu: yapay zekâ / bekleme satırında 'elle yanıt verin' notu", () => {
    expect(queue).toMatch(/row\.status === "blocked" && \(row\.messageType === "ai" \|\| row\.messageType === "holding_ack"\)/);
    expect(queue).toContain("bu cevap abonelik dönünce gönderilmeyecek; misafire elle yanıt verin");
  });

  it("gelen kutusu notu W7 metni (mevcut)", () => {
    expect(SKIP_REASON_LABELS.channel_paused).toBe("Kanal bağlantısı kapalıyken hazırlanan cevap gönderilmedi — lütfen elle yanıtlayın");
  });
});
