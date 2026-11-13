import { describe, it, expect } from "vitest";
import { evaluateStay, assignableStatus, type StayReadinessInput, type CleaningInput, type Factor } from "@/lib/readiness-list/evaluate";
import { assignErrorOf, ASSIGN_ERROR } from "@/components/arrivals/assign-task";

// ---------------------------------------------------------------------------
// UX-10 D3 (kurucu 11-13: "ilk 2'si kesinlikle olur"): Girişler satırından doğrudan atama. Kural SAF değerlendiricide: YALNIZ başlanmamış
// görevde (Yapılacak / Yapılamıyor); başlamış / bitmiş / onay bekleyen işte YOK (temizlikçi işin ortasında düşerdi); durumu bilinmeyen (eski
// çağıran) görevde YOK. Atamak hazırlık kanıtı DEĞİL — satırın etiketi ve genel hüküm değişmez. Tasarım §1.2 E1.
// ---------------------------------------------------------------------------

const TZ = "Europe/Istanbul";
const at = (iso: string) => new Date(iso);
const cleaning = (over: Partial<CleaningInput> = {}): CleaningInput => ({
  status: "not_ready",
  note: "open",
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
const task = (over: Partial<CleaningInput["tasks"][number]> = {}) => ({
  id: "t1",
  assignee: null,
  assigneeId: null,
  status: "todo",
  startedAt: null,
  startedBy: null,
  lastDoneAt: null,
  ...over,
});
const of = (input: StayReadinessInput, key: Factor["key"]) => evaluateStay(input).factors.filter((f) => f.key === key);
const cleaningFactor = (c: Partial<CleaningInput>) => of(stay({ cleaning: cleaning(c) }), "cleaning")[0]!;

describe("temizlik satırı — atama", () => {
  it("açık + kimseye atanmadı (T6) → 'Birini atayın', ön şart: atanmamış", () => {
    expect(cleaningFactor({ tasks: [task()] }).assign).toEqual({ taskId: "t1", expectAssigneeId: null, mode: "assign" });
  });

  it("açık + atanmış + başlanmadı (T7) → 'Değiştirin', ön şart: atanan kişi", () => {
    expect(cleaningFactor({ tasks: [task({ assignee: "Ayşe", assigneeId: "u-ayse" })] }).assign).toEqual({
      taskId: "t1",
      expectAssigneeId: "u-ayse",
      mode: "change",
    });
  });

  it("'Yapamıyorum' denmiş (T5) → 'Başkasına atayın'", () => {
    const f = cleaningFactor({
      tasks: [task({ assignee: "Ayşe", assigneeId: "u-ayse", status: "blocked", blocked: { at: at("2026-11-07T09:05:00Z"), by: "Ayşe", reason: "hastayım" } })],
    });
    expect(f.label).toMatch(/^Temizlik yapılamıyor/);
    expect(f.assign).toEqual({ taskId: "t1", expectAssigneeId: "u-ayse", mode: "reassign" });
  });

  it("🚨 iş başladı (T8) ya da görev 'Devam ediyor' / 'Onay bekliyor' / 'Tamamlandı' → atama YOK", () => {
    expect(cleaningFactor({ tasks: [task({ assigneeId: "u-ayse", startedAt: at("2026-11-07T08:20:00Z") })] }).assign).toBeUndefined();
    for (const status of ["in_progress", "awaiting_review", "done"]) {
      expect(cleaningFactor({ tasks: [task({ status })] }).assign, status).toBeUndefined();
    }
  });

  it("durumu bilinmeyen görev (eski çağıran) → atama YOK (sunucu da kabul etmezdi)", () => {
    expect(cleaningFactor({ tasks: [task({ status: undefined })] }).assign).toBeUndefined();
    expect(cleaningFactor({ tasks: [task({ status: null })] }).assign).toBeUndefined();
  });

  it("atama hükmü ve etiketi DEĞİŞTİRMEZ (atamak hazırlık kanıtı değil)", () => {
    const input = stay({ cleaning: cleaning({ tasks: [task()] }) });
    const out = evaluateStay(input);
    expect(out.overall).toBe("not_ready");
    expect(out.factors[0]!.label).toBe("Temizlik açık · kimseye atanmadı · başlanmadı");
  });
});

describe("bakım / söz satırları — atama", () => {
  const issue = (over: Record<string, unknown> = {}) => ({
    id: "i1",
    title: "Musluk damlatıyor",
    kindLabel: "Bakım",
    assignee: null,
    assigneeId: null,
    status: "todo",
    dueAt: at("2026-11-07T12:00:00Z"),
    relation: "turnover" as const,
    priority: "standard",
    ...over,
  });

  it("devre bağlı, kimseye atanmamış bakım (I1) → 'Birini atayın'; atanmışsa yalnız bağlantı", () => {
    const one = of(stay({ openIssue: true, issueTasks: [issue()] }), "issue")[0]!;
    expect(one.assign).toEqual({ taskId: "i1", expectAssigneeId: null, mode: "assign" });
    const assigned = of(stay({ openIssue: true, issueTasks: [issue({ assignee: "Ali", assigneeId: "u-ali" })] }), "issue")[0]!;
    expect(assigned.assign).toBeUndefined();
    expect(assigned.link).toEqual({ to: "task", taskId: "i1" });
  });

  it("düşük öncelikli bilgi satırı (I3) atama da bağlantı da taşımaz; başlamış bakım atanmaz", () => {
    const low = of(stay({ openIssue: true, issueTasks: [issue({ priority: "low" })] }), "issue")[0]!;
    expect(low.state).toBe("info");
    expect(low.assign).toBeUndefined();
    const started = of(stay({ openIssue: true, issueTasks: [issue({ status: "in_progress" })] }), "issue")[0]!;
    expect(started.assign).toBeUndefined();
  });

  it("eski konaklamadan kalan atanmamış bakım (I2, 'etkiliyor mu?') da atanabilir", () => {
    const f = of(
      stay({
        maintenanceOpen: true,
        issueTasks: [issue({ relation: "other_stay", stay: { arrivalKey: "2026-10-03", departureKey: "2026-10-06", when: "past" } })],
      }),
      "issue",
    )[0]!;
    expect(f.state).toBe("unknown");
    expect(f.assign).toEqual({ taskId: "i1", expectAssigneeId: null, mode: "assign" });
  });

  it("sözün görevi atanmamış (C1) → 'Birini atayın'; atanmış ya da görevsiz söz → yok", () => {
    const base = { id: "c1", label: "bebek yatağı", dueAt: at("2026-11-07T12:00:00Z"), assignee: null };
    expect(of(stay({ commitments: [{ ...base, taskId: "tc", taskAssigneeId: null, taskStatus: "todo" }] }), "commitment")[0]!.assign).toEqual({
      taskId: "tc",
      expectAssigneeId: null,
      mode: "assign",
    });
    expect(of(stay({ commitments: [{ ...base, taskId: "tc", taskAssigneeId: "u-a", taskStatus: "todo" }] }), "commitment")[0]!.assign).toBeUndefined();
    expect(of(stay({ commitments: [{ ...base, taskId: null }] }), "commitment")[0]!.assign).toBeUndefined();
    expect(of(stay({ commitments: [{ ...base, taskId: "tc", taskAssigneeId: null, taskStatus: "done" }] }), "commitment")[0]!.assign).toBeUndefined();
  });
});

describe("atanabilir durum kümesi (sunucu ile ortak)", () => {
  it("yalnız Yapılacak ve Yapılamıyor", () => {
    expect(["todo", "blocked"].every(assignableStatus)).toBe(true);
    expect(["in_progress", "awaiting_review", "done", "", null, undefined].some((s) => assignableStatus(s as string | null | undefined))).toBe(false);
  });
});

describe("sunucu cevabı → kullanıcı cümlesi", () => {
  it("bayat satır (409) → açıklama + liste yenilenir; kişi ekipten çıktı (400) → açıklama + yenile", () => {
    expect(assignErrorOf(409, { code: "assignee_changed" })).toEqual({ message: ASSIGN_ERROR.assignee_changed, refresh: true });
    expect(assignErrorOf(409, { code: "task_moved_on" })).toEqual({ message: ASSIGN_ERROR.task_moved_on, refresh: true });
    expect(assignErrorOf(400, { fields: { assignedToId: "Geçersiz personel" } })).toEqual({ message: ASSIGN_ERROR.member_gone, refresh: true });
  });

  it("yetki / bürünme → sunucunun cümlesi; bilinmeyen → genel cümle, yenileme yok", () => {
    expect(assignErrorOf(403, { error: "Destek görünümü salt okunurdur." })).toEqual({ message: "Destek görünümü salt okunurdur.", refresh: false });
    expect(assignErrorOf(500, null)).toEqual({ message: ASSIGN_ERROR.generic, refresh: false });
    expect(assignErrorOf(409, { code: "checklist_changed" })).toEqual({ message: ASSIGN_ERROR.generic, refresh: false });
  });
});
