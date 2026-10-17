import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  KB_SOURCES,
  KB_REVIEW_STATES,
  AI_READABLE_REVIEW_STATES,
  KB_APPROVAL_GATE_WHERE,
  GUEST_DELIVERABLE_KB_WHERE,
  isAiReadableReviewState,
} from "@/lib/kb-review";

// ---------------------------------------------------------------------------
// A1 — ONAY SÖZLEŞMESİNİN KENDİSİ (kapalı kümeler + kapının yerleri).
//
// Davranışsal testler (kb-review-state, kb-template-approval-gate) "bugün doğru
// çalışıyor" der. Bu dosya "yarın sessizce bozulamaz" der: kümeye yeni bir durum
// eklendiğinde allowlist kararının BİLİNÇLİ verilmesini zorlar ve kapının hâlâ
// tek yerde olduğunu pinler.
// ---------------------------------------------------------------------------

function read(rel: string): string {
  return readFileSync(path.resolve(__dirname, "../../", rel), "utf8");
}

describe("A1 — KB onay sözleşmesi", () => {
  it("allowlist kapalı kümenin ALT KÜMESİDİR (yazım hatası sessizce her şeyi elemez)", () => {
    for (const s of AI_READABLE_REVIEW_STATES) {
      expect(KB_REVIEW_STATES).toContain(s);
    }
  });

  it("`draft` allowlist'te DEĞİL, `legacy` allowlist'te", () => {
    // `legacy` çıkarılırsa canlıdaki her mülkün bilgi tabanı bir migration ile
    // boşalır: bugün modele giden satırların TAMAMI o sınıfa düşüyor.
    expect(isAiReadableReviewState("legacy")).toBe(true);
    expect(isAiReadableReviewState("approved")).toBe(true);
    expect(isAiReadableReviewState("draft")).toBe(false);
    // Tanınmayan bir değer de dışarıda kalır (allowlist mantığı).
    expect(isAiReadableReviewState("rejected")).toBe(false);
    expect(isAiReadableReviewState("")).toBe(false);
  });

  it("küme büyürse allowlist kararı ELDE ALINIR (yeni durum varsayılan olarak DIŞARIDA)", () => {
    const undecided = KB_REVIEW_STATES.filter(
      (s) => !(AI_READABLE_REVIEW_STATES as readonly string[]).includes(s),
    );
    // Bugün yalnız `draft` dışarıda. Yeni bir durum eklenip bilerek allowlist'e
    // konmadıysa bu liste büyür ve test, kararın yazılmasını ister.
    expect(undecided).toEqual(["draft"]);
    expect(KB_SOURCES).toEqual(["legacy", "host_manual", "extracted_draft", "suggestion_accepted"]);
  });

  it("misafire giden fragment onay kapısını İÇERİR (aktiflik onun yerini tutmaz)", () => {
    expect(GUEST_DELIVERABLE_KB_WHERE.isActive).toBe(true);
    expect(GUEST_DELIVERABLE_KB_WHERE.reviewState).toEqual(KB_APPROVAL_GATE_WHERE.reviewState);
  });

  it("onay kapısı TEK KAYNAKTAN geliyor — yüzeyler kendi listesini yazmaz", () => {
    // Kapalı kümeyi elle tekrar yazan bir yüzey, küme değişince sessizce eskir.
    for (const rel of [
      "src/lib/ai/kb-fetch.ts",
      "src/lib/automation.ts",
      "src/app/(app)/sent/page.tsx",
      "src/modules/intelligence/memory/bootstrap.ts",
    ]) {
      const src = read(rel);
      expect(src, rel).toMatch(/from "@\/lib\/kb-review"/);
      expect(src, rel).not.toMatch(/reviewState:\s*\{\s*in:\s*\[/);
    }
  });

  it("şablon yolları (gönderici + önizleme) BARE `isActive: true` ile sorgulamıyor", () => {
    const src = read("src/lib/automation.ts");
    for (const cat of ["welcome", "checkin", "checkout"]) {
      // Gönderici ve önizleme = 2 sorgu, ikisi de ortak fragmenti kullanır.
      const gated = src.match(
        new RegExp(`category: "${cat}", \\.\\.\\.GUEST_DELIVERABLE_KB_WHERE`, "g"),
      );
      expect(gated?.length, cat).toBe(2);
      expect(src, cat).not.toContain(`category: "${cat}", isActive: true`);
    }
  });

  it("A5 alanları: sourceRef KB rotalarında hiç yazılmıyor; supersededById YALNIZ L2 yollarında (bilinçli güncelleme, kurucu 10-17)", () => {
    // Şema onları migration 53'te taşıyor. L2 (Geçmişten öğren "eskisinin yerine koy") supersededById'yi YAZAN tek yol: taslak onayı
    // (`history-learn/service.ts`); KB PATCH yalnız TEMİZLER (ev sahibi eskiyi yeniden etkinleştirince). Ekleme / kopyalama rotaları yazmaz.
    for (const rel of ["src/app/api/kb/route.ts", "src/app/api/kb/[id]/copy/route.ts"]) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/\bsupersededById\b/);
      expect(src, rel).not.toMatch(/\bsourceRef\b/);
    }
    const patch = read("src/app/api/kb/[id]/route.ts");
    expect(patch).not.toMatch(/\bsourceRef\b/);
    // PATCH yalnız NULL'a çeker (temizleme); bir kimlik ATAMAZ.
    expect(patch.match(/supersededById:\s*(?!true)[^,}\s]+/g)?.every((m) => /null$/.test(m))).toBe(true);
    expect(read("src/lib/history-learn/service.ts")).toMatch(/supersededById: kb\.id, supersededAt: now/);
  });
});
