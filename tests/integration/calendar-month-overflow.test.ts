import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

// ---------------------------------------------------------------------------
// TAKVİM AY PARAMETRESİ TAŞMASI (G2 tur 4 T4-B13, düzeltildi 11-20: `lib/calendar-month.ts` yıl aralığı) (A-1 sınıfı komşusu: kullanıcının tetiklediği sahte 500 → ORTAK "uncaught-request" alarm kovası).
// Takvim sayfası `?month=YYYY-MM` değerini düzenli ifadeyle doğrular (`^\d{4}-(0[1-9]|1[0-2])$`) — 9999-12 geçer. Sorgu penceresi ayın
// sonuna +2 gün eklenerek kurulur (`calendar/page.tsx` queryEnd) → 10000-01-03 → Prisma sorgusu fırlatır → sayfa çizimi fırlatır → Next
// `onRequestError` → `reportUncaughtRequestError` → `reportError("uncaught-request")`: bütün yakalanmayan istek hatalarının PAYLAŞTIĞI tek
// kova (10 dk'da bir e-posta). Herhangi bir yönetici (deneme hesabı yeter) `/calendar?month=9999-12` ile kovayı sürekli dolu tutup gerçek
// bir arızanın e-postasını bastırabilir — Tur 1'deki NUL vektörleriyle (`repro-nul-page-param`) aynı sınıf, farklı girdi.
// KONTROL: 9999-11 (pencere 9999-12-02'de biter) sorunsuz çizilir.
// Next'in kancayı çağırması çerçeve davranışıdır; burada sayfa işlevi doğrudan çağrılır ve fırlattığı hata ürünün kendi kanca gövdesine verilir.
// ---------------------------------------------------------------------------

let session: SessionPayload;
vi.mock("@/lib/auth/manager-page", () => ({ requireManagerSession: vi.fn(async () => session) }));
const reported: string[] = [];
vi.mock("@/lib/report-error", async (orig) => ({
  ...(await orig<typeof import("@/lib/report-error")>()),
  reportError: vi.fn(async (context: string) => {
    reported.push(context);
    return { configured: false, notified: false, throttled: false };
  }),
}));

import CalendarPage from "@/app/(app)/calendar/page";
import { reportUncaughtRequestError, shouldReportRequestError } from "@/lib/request-error-report";

async function renderOutcome(month: string): Promise<{ threw: boolean; flowControl: boolean; reported: string[]; message?: string }> {
  try {
    await CalendarPage({ searchParams: Promise.resolve({ month }) } as never);
    return { threw: false, flowControl: false, reported: [...reported] };
  } catch (err) {
    const flowControl = !shouldReportRequestError(err);
    await reportUncaughtRequestError(err, { method: "GET" }, { routePath: "/calendar", routeType: "render", renderSource: "react-server-components" });
    return { threw: true, flowControl, reported: [...reported], message: String((err as Error).message).replace(/\s+/g, " ").slice(-400) };
  }
}

describe("T4-B13 — takvim ?month=9999-12 → yakalanmayan istek hatası ('uncaught-request' kovası)", () => {
  beforeEach(async () => {
    await resetDb();
    reported.length = 0;
    const { orgId } = await makeOrgWithProperty();
    session = { userId: "u", organizationId: orgId, role: "owner", email: "o@ornek.com", name: "O", sessionEpoch: 0 } as SessionPayload;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("KONTROL: ?month=9999-11 çizilir, rapor YOK", async () => {
    expect(await renderOutcome("9999-11")).toEqual({ threw: false, flowControl: false, reported: [] });
  });

  it.each([["9999-12"], ["0000-01"], ["3000-01"]])("🚨 ?month=%s → varsayılan aya düşer ve çizilir, rapor YOK (eskiden Prisma hatası + 'uncaught-request')", async (month) => {
    const out = await renderOutcome(month);
    expect({ threw: out.threw, reported: out.reported }).toEqual({ threw: false, reported: [] });
  });
});
