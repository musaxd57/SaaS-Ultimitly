import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONVERSATION_STATUS, LEGACY_CONVERSATION_STATUSES } from "@/lib/constants";
import { conversationUpdateSchema } from "@/lib/validators";

// ---------------------------------------------------------------------------
// "BEKLEMEDE" KALDIRILDI (kurucu, 2026-09-11: "2.yap").
//
// 🚨 O DURUM BELGELENMEMİŞ BİR AI KİLİDİYDİ. `dueAutoReplyWhere` aday kümesini
// yalnız `status:"new"` üzerinden seçiyordu; host "Beklemede" dediğinde
// oto-yanıt o konuşmayı bir daha HİÇ seçmiyor ve bunu hiçbir ekran
// söylemiyordu (`problem` gibi bir rozet/veto YOK). Host "sonra bakarım" diye
// işaretliyor, AI sessizce susuyordu.
//
// SÖZLEŞME (bu dosya PİNLER):
//  1. Seçenek listesinde YOK → seçim kutusu, gelen kutusu sekmesi ve zod enum'u
//     (türetilmiş) otomatik takip eder; PATCH artık 400 döner.
//  2. TİP birliğinde KALIR — kolon düz TEXT, DB'de eski satırlar olabilir.
//  3. 🚨 Eski satırlar TUZAKTA KALMAZ: oto-yanıt aday sorgusu `waiting`i de
//     seçer, yani `new` ile aynı davranır.
// ---------------------------------------------------------------------------

describe("Conversation durumu — 'Beklemede' yazma yüzeyinden kalktı", () => {
  it("🚨 seçenek listesinde YOK", () => {
    expect(CONVERSATION_STATUS.values).not.toContain("waiting");
    expect(CONVERSATION_STATUS.options.map((o) => o.label)).not.toContain("Beklemede");
    // Anti-vakum: liste boşalmadı, kardeş durumlar duruyor.
    expect(CONVERSATION_STATUS.values).toEqual(
      expect.arrayContaining(["new", "answered", "problem", "closed"]),
    );
  });

  it("🚨 PATCH artık reddediyor (zod enum seçeneklerden TÜRETİLMİŞ)", () => {
    expect(conversationUpdateSchema.safeParse({ status: "waiting" }).success).toBe(false);
    // Ters yön: geçerli bir durum hâlâ kabul.
    expect(conversationUpdateSchema.safeParse({ status: "problem" }).success).toBe(true);
  });

  it("etiket çözümü eski satırı HAM KOD olarak göstermez", () => {
    // `optionMap.label` bilinmeyen değeri aynen döndürür; host'a İngilizce
    // "waiting" göstermemek için legacy sabiti kayıtta duruyor ve okuma
    // sorguları onu `new` gibi ele alıyor (↓ aday sorgusu pini).
    expect(LEGACY_CONVERSATION_STATUSES).toContain("waiting");
  });

  it("🚨 ESKİ SATIRLAR TUZAKTA KALMAZ: oto-yanıt aday sorgusu `waiting`i de seçer", () => {
    // Davranışsal integration pini ayrı (`auto-reply-channel`); burada ölçülen
    // şey kilidin KAYNAĞININ kapandığı: `status: "new"` literali gitti.
    const src = readFileSync(join(process.cwd(), "src/lib/automation.ts"), "utf8");
    const at = src.indexOf("function dueAutoReplyWhere(");
    expect(at, "dueAutoReplyWhere bulunamadı").toBeGreaterThan(-1);
    const body = src
      .slice(at, at + 2500)
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
      .join("\n");
    expect(body).toContain("LEGACY_CONVERSATION_STATUSES");
    expect(body).not.toMatch(/^\s*status: "new",\s*$/m);
  });

  it("`closed` KALDI — yalnız 'Beklemede' kaldırıldı (aşırı uygulama kontrolü)", () => {
    expect(CONVERSATION_STATUS.values).toContain("closed");
    expect(conversationUpdateSchema.safeParse({ status: "closed" }).success).toBe(true);
  });
});
