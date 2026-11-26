import { describe, it, expect } from "vitest";
import { evaluateStay, type StayReadinessInput, type CleaningInput, type Factor } from "@/lib/readiness-list/evaluate";
import { factorLinkTarget } from "@/components/arrivals/arrivals-list";

// ---------------------------------------------------------------------------
// UX-10 D2 (kurucu 11-13 "UX-10 b iyi, güzelce uzun uzun düşünerek yap"): Girişler satırının yanında, satırı ÇÖZEN ekrana götüren tek
// bağlantı. Karar SAF değerlendiricide (aynı girdi → aynı bağlantı); bağlantı yazmaz, misafire / personele hiçbir şey göndermez; etiket ve
// genel hüküm DEĞİŞMEZ. Bilinçli bağlantısız satırlar: bekleme (5 dk), iş sürüyor, çekirdeğin değiştiremediği satır, silinmiş misafir.
// Tasarım: scratchpad/handoff/UX-10-girisler-tasarim.md §1.1 (T/A/I/O/C/N/NE kodları oradaki tablodan).
// ---------------------------------------------------------------------------

const TZ = "Europe/Istanbul";
const at = (iso: string) => new Date(iso);
const cleaning = (over: Partial<CleaningInput> = {}): CleaningInput => ({
  status: "unknown",
  note: "none",
  previousKnown: true,
  previousCheckout: "11:00",
  readyMark: null,
  tasks: [],
  ...over,
});
const stay = (over: Partial<StayReadinessInput> = {}): StayReadinessInput => ({
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
});
const of = (input: StayReadinessInput, key: Factor["key"]) => evaluateStay(input).factors.filter((f) => f.key === key);
const cleaningLink = (c: Partial<CleaningInput>) => of(stay({ cleaning: cleaning(c) }), "cleaning")[0]!.link;
const accessLink = (a: StayReadinessInput["autoCheckin"]) => of(stay({ autoCheckin: a }), "access")[0]!.link;
const task = (over: Partial<CleaningInput["tasks"][number]> = {}) => ({ id: "t1", assignee: null, startedAt: null, startedBy: null, lastDoneAt: null, ...over });

describe("temizlik satırları", () => {
  it("okunamadı (T1) → yenile; çıkış saati okunamadı (T10) → mülk sayfası; görev yok (T12) → görevler", () => {
    expect(cleaningLink({ unavailable: true })).toEqual({ to: "refresh" });
    expect(cleaningLink({ tasks: [task()] })).toEqual({ to: "property_times" });
    expect(cleaningLink({})).toEqual({ to: "tasks" });
  });

  it("açık + başlanmamış (T6 / T7) ve çıkıştan önce 'bitti' (T4) → o görevin kartı", () => {
    expect(cleaningLink({ status: "not_ready", note: "open", tasks: [task()] })).toEqual({ to: "task", taskId: "t1" });
    expect(cleaningLink({ status: "not_ready", note: "open", tasks: [task({ assignee: "Ayşe" })] })).toEqual({ to: "task", taskId: "t1" });
    expect(cleaningLink({ status: "not_ready", note: "before_checkout", tasks: [task({ lastDoneAt: at("2026-11-07T07:05:00Z") })] })).toEqual({
      to: "task",
      taskId: "t1",
    });
  });

  it("🚨 bilinçli bağlantısız: iş SÜRÜYOR (T8), 5 dk bekleme (T3), önceki çıkış kayıtlı değil (T9), temizlik bitti (T2)", () => {
    expect(cleaningLink({ status: "not_ready", note: "open", tasks: [task({ assignee: "Ayşe", startedAt: at("2026-11-07T08:20:00Z") })] })).toBeUndefined();
    expect(cleaningLink({ status: "not_ready", note: "fresh", tasks: [task({ lastDoneAt: at("2026-11-07T09:58:00Z") })] })).toBeUndefined();
    expect(cleaningLink({ previousKnown: false })).toBeUndefined();
    expect(
      cleaningLink({ status: "ready", readyMark: { id: "u1", at: at("2026-11-07T09:40:00Z"), by: "Ayşe" }, tasks: [task({ assignee: "Ayşe" })] }),
    ).toBeUndefined();
  });

  it("'yapılamıyor' (T5) → yapamayan kişinin görevi", () => {
    const blocked = { at: at("2026-11-07T09:05:00Z"), by: "Ayşe", reason: "hastayım" };
    expect(cleaningLink({ status: "not_ready", note: "open", tasks: [task({ id: "t0" }), task({ id: "t2", blocked })] })).toEqual({ to: "task", taskId: "t2" });
  });
});

describe("otomatik giriş mesajı satırları", () => {
  it("düzeltin (A3) · kontrol edin (A4) · yazın (A5) → mülkün otomatik mesaj kartı", () => {
    expect(accessLink({ state: "skipped", reason: "unfilled" })).toEqual({ to: "auto_message", reason: "fix" });
    expect(accessLink({ state: "review", id: "a1", at: at("2026-11-06T10:00:00Z") })).toEqual({ to: "auto_message", reason: "check" });
    expect(accessLink({ state: "missing" })).toEqual({ to: "auto_message", reason: "write" });
  });

  it("gitmiyorsa sebebe göre: kapalı / taban → konuşma, bağlantı yok → bağlantı", () => {
    expect(accessLink({ state: "disabled" })).toEqual({ to: "conversation" });
    expect(accessLink({ state: "not_sending", reason: "kill_switch" })).toEqual({ to: "conversation" });
    expect(accessLink({ state: "not_sending", reason: "no_baseline" })).toEqual({ to: "conversation" });
    expect(accessLink({ state: "not_sending", reason: "before_baseline" })).toEqual({ to: "conversation" });
    expect(accessLink({ state: "not_sending", reason: "no_connection" })).toEqual({ to: "connection" });
  });

  it("🚨 SİLİNMİŞ misafire ve konuşması olmayana hiçbir eylem yok; gönderildi / hazır satırında da yok ('şimdi gönder' çift gönderim riski)", () => {
    expect(accessLink({ state: "not_sending", reason: "erased" })).toBeUndefined();
    expect(accessLink({ state: "not_sending", reason: "no_channel" })).toBeUndefined();
    expect(accessLink({ state: "sent", at: at("2026-11-07T06:10:00Z") })).toBeUndefined();
    expect(accessLink({ state: "ready", id: "a1", at: at("2026-11-06T10:00:00Z") })).toBeUndefined();
  });
});

describe("diğer satırlar", () => {
  it("bakım: devre bağlı engel → görev; eski konaklamadan → görev; düşük öncelik bilgi → yok; dayanaksız → görevler", () => {
    const base = { openIssue: true, maintenanceOpen: false };
    const issues = of(
      stay({
        ...base,
        issueTasks: [
          { id: "m1", title: "Klima", kindLabel: "Bakım", assignee: null, dueAt: at("2026-11-07T08:00:00Z") },
          { id: "m2", title: "Ampul", kindLabel: "Bakım", assignee: null, dueAt: at("2026-11-07T08:00:00Z"), priority: "low" },
        ],
      }),
      "issue",
    );
    expect(issues.map((f) => f.link)).toEqual([{ to: "task", taskId: "m1" }, undefined]);
    expect(of(stay({ ...base, issueTasks: [] }), "issue")[0]!.link).toEqual({ to: "tasks" });
  });

  it("çakışma → takvim; söz → sözün görevi; açık ihtiyaç → konuşma; not → notun görevi", () => {
    expect(of(stay({ overlaps: 1 }), "overlap")[0]!.link).toEqual({ to: "calendar" });
    expect(
      of(stay({ commitments: [{ id: "c1", label: "Bebek yatağı", dueAt: at("2026-11-07T12:00:00Z"), assignee: null, taskId: "k1" }] }), "commitment")[0]!.link,
    ).toEqual({ to: "task", taskId: "k1" });
    expect(of(stay({ needs: [{ id: "n1", label: "Otopark", status: "pending_host", at: at("2026-11-06T10:00:00Z") }] }), "need")[0]!.link).toEqual({
      to: "conversation",
      need: true,
    });
    expect(of(stay({ cleaning: cleaning({ tasks: [task()] }), cleaningNote: true }), "cleaning_note")[0]!.link).toEqual({ to: "task", taskId: "t1", note: true });
  });

  it("🚨 bağlantı genel hükmü değiştirmez (aynı girdi, aynı hüküm)", () => {
    const r = evaluateStay(stay({ cleaning: cleaning({ status: "not_ready", note: "open", tasks: [task()] }) }));
    expect(r.overall).toBe("not_ready");
    expect(r.factors.find((f) => f.key === "cleaning")!.label).toBe('Temizlik açık · kimseye atanmadı · başlanmadı');
  });
});

describe("görünüm: bağlantı adresi + metin", () => {
  const row = { propertyId: "p1", conversationId: "c9" };
  it("adresler ve metinler", () => {
    expect(factorLinkTarget({ to: "task", taskId: "t1" }, row, false)).toEqual({ href: "/tasks?propertyId=p1#task-t1", label: "Görevi açın" });
    expect(factorLinkTarget({ to: "task", taskId: null, note: true }, row, false)).toEqual({ href: "/tasks?propertyId=p1", label: "Notu okuyun" });
    expect(factorLinkTarget({ to: "auto_message", reason: "write" }, row, false)).toEqual({ href: "/properties/p1#otomatik-mesajlar", label: "Giriş mesajını yazın" });
    expect(factorLinkTarget({ to: "calendar" }, row, false)).toEqual({ href: "/calendar?property=p1", label: "Takvimde görün" });
    expect(factorLinkTarget({ to: "conversation", need: true }, row, false)).toEqual({ href: "/inbox/c9", label: "Konuşmada görün" });
    expect(factorLinkTarget({ to: "property_times" }, row, false)).toEqual({ href: "/properties/p1", label: "Çıkış saatini girin" });
  });

  it("konuşma yoksa konuşma bağlantısı yok; bağlantı kurma yalnız kurabilecek kişiye", () => {
    expect(factorLinkTarget({ to: "conversation" }, { propertyId: "p1", conversationId: null }, true)).toBeNull();
    expect(factorLinkTarget({ to: "connection" }, row, false)).toBeNull();
    expect(factorLinkTarget({ to: "connection" }, row, true)).toEqual({ href: "/settings?tab=baglantilar", label: "Bağlantıyı kurun" });
    expect(factorLinkTarget(undefined, row, true)).toBeNull();
  });
});
