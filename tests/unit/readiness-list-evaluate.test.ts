import { describe, it, expect } from "vitest";
import { evaluateStay, OVERALL_LABEL, type StayReadinessInput, type CleaningInput } from "@/lib/readiness-list/evaluate";

// ---------------------------------------------------------------------------
// Giriş hazırlığı listesi — saf değerlendirici (kurucu H1 / H-2, 11-05). Kurallar: eksik veri asla hazır değil; her faktör dayanak + eksik
// şart taşır; ATANMIŞ OLMAK kanıt değil (temizlik yalnız çekirdeğin "hazır" hükmüyle — çıkıştan sonra kimlikli "bitti"); erişim v1'de
// "kontrol edilmedi" → genel durum hiçbir zaman "HAZIR" değil, en iyisi "TEMİZLİK HAZIR".
// ---------------------------------------------------------------------------

const TZ = "Europe/Istanbul";
const at = (iso: string) => new Date(iso);

function cleaning(over: Partial<CleaningInput> = {}): CleaningInput {
  return { status: "unknown", note: "none", previousKnown: true, previousCheckout: "11:00", readyMark: null, tasks: [], ...over };
}

function stay(over: Partial<StayReadinessInput> = {}): StayReadinessInput {
  return {
    timeZone: TZ,
    now: at("2026-11-07T10:00:00Z"),
    cleaning: cleaning(),
    openIssue: false,
    maintenanceOpen: false,
    overlaps: 0,
    commitments: [],
    needs: [],
    accessInstructions: null,
    checkInTime: "15:00",
    ...over,
  };
}

const cleaningFactor = (r: ReturnType<typeof evaluateStay>) => r.factors.find((f) => f.key === "cleaning")!;

describe("giriş hazırlığı — saf değerlendirici", () => {
  it("🚨 ATANMIŞ ama bitmemiş temizlik → HAZIR DEĞİL; kim atandı / başlanmadı söylenir, eksik şart çıkıştan sonra 'bitti'", () => {
    const r = evaluateStay(
      stay({
        cleaning: cleaning({
          status: "not_ready",
          note: "open",
          tasks: [{ id: "t1", assignee: "Ayşe", startedAt: null, startedBy: null, lastDoneAt: null }],
        }),
      }),
    );
    expect(r.overall).toBe("not_ready");
    const f = cleaningFactor(r);
    expect(f.state).toBe("blocking");
    expect(f.label).toBe("Temizlik açık · atanan: Ayşe · başlanmadı");
    expect(f.missing).toBe('çıkıştan (11:00) sonra "bitti" kaydı');
    expect(f.basis).toEqual([{ kind: "task", id: "t1", at: null }]);
  });

  it("başlanmış temizlik de kanıt değildir: saat (işletme diliminde) ve kişi söylenir, durum engel", () => {
    const r = evaluateStay(
      stay({
        cleaning: cleaning({
          status: "not_ready",
          note: "open",
          tasks: [{ id: "t1", assignee: "Ayşe", startedAt: at("2026-11-07T08:20:00Z"), startedBy: "Ayşe", lastDoneAt: null }],
        }),
      }),
    );
    expect(cleaningFactor(r).label).toBe("Temizlik açık · atanan: Ayşe · başladı 11:20 (Ayşe)");
    expect(r.overall).toBe("not_ready");
  });

  it("🚨 çekirdek 'hazır' dediğinde: 'TEMİZLİK HAZIR' — ama genel durum ASLA 'HAZIR' değil (erişim kontrol edilmedi, H-2)", () => {
    const r = evaluateStay(
      stay({
        cleaning: cleaning({ status: "ready", note: "none", readyMark: { id: "u9", at: at("2026-11-07T09:40:00Z"), by: "Ayşe" } }),
        accessInstructions: { id: "kb1", at: at("2026-10-01T00:00:00Z") },
      }),
    );
    expect(r.overall).toBe("cleaning_ready");
    expect(OVERALL_LABEL[r.overall]).toBe("TEMİZLİK HAZIR");
    expect(Object.values(OVERALL_LABEL)).not.toContain("HAZIR");
    const f = cleaningFactor(r);
    expect(f.state).toBe("ok");
    expect(f.label).toBe("Temizlik bitti 12:40 · Ayşe · çıkıştan (11:00) sonra");
    expect(f.basis).toEqual([{ kind: "task_done", id: "u9", at: at("2026-11-07T09:40:00Z") }]);
    const access = r.factors.find((x) => x.key === "access")!;
    expect(access.state).toBe("info");
    expect(access.label).toContain("kontrol edilmedi");
    expect(r.factors.some((x) => x.state === "ok" && x.key !== "cleaning")).toBe(false);
  });

  it("'hazır' hükmü yoksa 'bitti' işareti tek başına ok yazdırmaz (işaret verilmiş olsa da durum hazır değil)", () => {
    const r = evaluateStay(
      stay({
        cleaning: cleaning({
          status: "not_ready",
          note: "fresh",
          readyMark: { id: "u1", at: at("2026-11-07T09:58:00Z"), by: "Ayşe" },
          tasks: [{ id: "t1", assignee: null, startedAt: null, startedBy: null, lastDoneAt: at("2026-11-07T09:58:00Z") }],
        }),
      }),
    );
    expect(cleaningFactor(r).state).toBe("blocking");
    expect(cleaningFactor(r).label).toBe("Temizlik bitti 12:58 — birkaç dakika içinde kesinleşir");
    expect(cleaningFactor(r).missing).toBe("5 dakikalık bekleme");
  });

  it("çıkıştan önce atılmış 'bitti' işareti → engel, eksik şart çıkıştan sonraki kayıt", () => {
    const r = evaluateStay(stay({ cleaning: cleaning({ status: "not_ready", note: "before_checkout", tasks: [{ id: "t1", assignee: "Ayşe", startedAt: null, startedBy: null, lastDoneAt: at("2026-11-07T07:05:00Z") }] }) }));
    expect(cleaningFactor(r).label).toBe('"Bitti" işareti çıkıştan önce (10:05)');
    expect(cleaningFactor(r).missing).toBe('çıkıştan (11:00) sonra atılmış "bitti" kaydı');
  });

  it("🚨 bilinmeyen asla yeşil değil: görev yok / önceki çıkış yok / zamansız 'bitti' → BİLİNMİYOR, eksik şart yazılı", () => {
    const noTask = evaluateStay(stay({ cleaning: cleaning({ status: "unknown", note: "none" }) }));
    expect(noTask.overall).toBe("unknown");
    expect(cleaningFactor(noTask)).toMatchObject({ state: "unknown", label: "Devir temizliği görevi yok", missing: "devir temizliği görevi" });
    const noPrev = evaluateStay(stay({ cleaning: cleaning({ status: "unknown", note: "none", previousKnown: false, previousCheckout: null }) }));
    expect(cleaningFactor(noPrev)).toMatchObject({ state: "unknown", label: "Önceki çıkış kayıtlı değil" });
    const noTime = evaluateStay(stay({ cleaning: cleaning({ status: "unknown", note: "no_time" }) }));
    expect(cleaningFactor(noTime).state).toBe("unknown");
    expect(cleaningFactor(noTime).missing).toBe('kişi adına "bitti" kaydı');
  });

  it("🚨 temizlik hazır olsa da varışa kadar yerine getirilecek açık SÖZ → HAZIR DEĞİL", () => {
    const r = evaluateStay(
      stay({
        cleaning: cleaning({ status: "ready", readyMark: { id: "u1", at: at("2026-11-07T09:00:00Z"), by: null } }),
        commitments: [{ id: "c1", label: "Bebek yatağı", dueAt: at("2026-11-07T12:00:00Z"), assignee: "Mehmet" }],
      }),
    );
    expect(r.overall).toBe("not_ready");
    expect(r.factors.find((f) => f.key === "commitment")).toMatchObject({ state: "blocking", label: "Söz açık: Bebek yatağı · atanan: Mehmet" });
  });

  it("açık ihtiyaç yalnız BİLGİ — engellemez; ev sahibinde bekleyen işaretlenir", () => {
    const r = evaluateStay(
      stay({
        cleaning: cleaning({ status: "ready", readyMark: { id: "u1", at: at("2026-11-07T09:00:00Z"), by: null } }),
        needs: [{ id: "i1", label: "Otopark", status: "pending_host", at: at("2026-11-06T10:00:00Z") }],
      }),
    );
    expect(r.overall).toBe("cleaning_ready");
    expect(r.factors.find((f) => f.key === "need")).toMatchObject({ state: "info", label: "Açık ihtiyaç: Otopark (sizde)" });
  });

  it("açık sorun / bakım ve çift rezervasyon engeldir; engel bilinmeyenin önüne geçer", () => {
    const issue = evaluateStay(stay({ openIssue: true }));
    expect(issue.overall).toBe("not_ready");
    expect(issue.factors.find((f) => f.key === "issue")!.label).toBe("Devirde açık sorun / bakım görevi var");
    const maint = evaluateStay(stay({ maintenanceOpen: true }));
    expect(maint.factors.find((f) => f.key === "issue")!.label).toBe("Mülkte açık bakım görevi var");
    const overlap = evaluateStay(stay({ overlaps: 1 }));
    expect(overlap.overall).toBe("not_ready");
    expect(overlap.factors.some((f) => f.key === "overlap" && f.state === "blocking")).toBe(true);
  });

  it("KONTROL — engel yoksa sorun / çakışma faktörü YAZILMAZ; giriş talimatı yoksa erişim yine bilgi (engel değil)", () => {
    const r = evaluateStay(stay({ cleaning: cleaning({ status: "ready", readyMark: { id: "u1", at: at("2026-11-07T09:00:00Z"), by: null } }) }));
    expect(r.factors.map((f) => f.key)).toEqual(["cleaning", "access", "timing"]);
    expect(r.factors.find((f) => f.key === "access")).toMatchObject({ state: "info", label: "Giriş talimatı bilgi tabanında yok · erişim kontrol edilmedi" });
    expect(r.factors.find((f) => f.key === "timing")!.label).toBe("önceki çıkış 11:00 → giriş 15:00");
  });

  it("okunamayan hüküm BİLİNMİYOR'dur (asla yeşil değil), çekirdek 'hazır' dese bile", () => {
    const r = evaluateStay(stay({ cleaning: cleaning({ unavailable: true, status: "ready", readyMark: { id: "u1", at: at("2026-11-07T09:00:00Z"), by: null } }) }));
    expect(r.overall).toBe("unknown");
    expect(cleaningFactor(r)).toMatchObject({ state: "unknown", label: "Temizlik durumu şu an okunamadı" });
  });

  it("temizlikçi notu BİLGİ satırıdır — genel durumu değiştirmez", () => {
    const base = stay({ cleaning: cleaning({ status: "ready", readyMark: { id: "u1", at: at("2026-11-07T09:00:00Z"), by: null } }) });
    const withNote = evaluateStay({ ...base, cleaningNote: true });
    expect(withNote.overall).toBe("cleaning_ready");
    expect(withNote.factors.find((f) => f.key === "cleaning_note")).toMatchObject({ state: "info" });
    expect(evaluateStay(base).factors.some((f) => f.key === "cleaning_note")).toBe(false);
  });

  it("saat işletmenin saat diliminde yazılır (aynı an, farklı dilim)", () => {
    const ready = cleaning({ status: "ready", readyMark: { id: "u1", at: at("2026-11-07T15:40:00Z"), by: null } });
    expect(cleaningFactor(evaluateStay(stay({ timeZone: "America/New_York", cleaning: ready }))).label).toBe("Temizlik bitti 10:40 · çıkıştan (11:00) sonra");
    expect(cleaningFactor(evaluateStay(stay({ timeZone: TZ, cleaning: ready }))).label).toBe("Temizlik bitti 18:40 · çıkıştan (11:00) sonra");
  });
});
