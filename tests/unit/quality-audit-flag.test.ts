import { describe, it, expect, vi, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Codex 11-05 (43fb93e): kalite denetçisi (maskelenmiş misafir mesajlarını Anthropic'e gönderir) yalnız AYRI anahtarla açılır —
// karar yazıcısı için `ANTHROPIC_API_KEY` tanımlanması onu kendiliğinden açmaz (gizlilik metni: Anthropic'e misafir mesajı iletilmez).
// Yönetici sayfası kartı ve doğrudan çağrı da aynı kurala uyar. Uçtan uca rota: tests/integration/admin-quality-audit.test.ts.
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { qualityAuditConfigured, qualityAuditEnabled, runQualityAudit, QualityAuditError } from "@/lib/quality-audit";

afterEach(() => vi.unstubAllEnvs());

describe("kalite denetçisi anahtarı", () => {
  it("🚨 API anahtarı tanımlı ama ayrı anahtar kapalı → kullanılamaz (yönetici kartı da pasif)", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    vi.stubEnv("QUALITY_AUDIT_ENABLED", "");
    expect(qualityAuditEnabled()).toBe(false);
    expect(qualityAuditConfigured()).toBe(false);
  });

  it("yalnız tam '1' açar; anahtar + API anahtarı → kullanılabilir", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    vi.stubEnv("QUALITY_AUDIT_ENABLED", "true");
    expect(qualityAuditConfigured()).toBe(false);
    vi.stubEnv("QUALITY_AUDIT_ENABLED", "1");
    expect(qualityAuditConfigured()).toBe(true);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(qualityAuditConfigured()).toBe(false);
  });

  it("🚨 doğrudan çağrı da anahtar kapalıyken çalışmaz (rota dışı çağıran atlayamaz)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    vi.stubEnv("QUALITY_AUDIT_ENABLED", "");
    const err = await runQualityAudit("org-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QualityAuditError);
    expect((err as QualityAuditError).code).toBe("not_configured");
  });
});
