import { describe, it, expect } from "vitest";
import { cleaningDayOrderGroups, orderDayJobs, type CleaningJob } from "@/lib/tasks/day-order";

// ---------------------------------------------------------------------------
// Plan madde 10 (A) — temizlik gün sırası önerisi, SAF kural. Tasarım `docs/TASARIM-2026-11-25-temizlikci-gun-sirasi-ve-ay-sayimi.md`.
// Sıra: ① aynı gün girişi + erken giriş (istenen / onaylı) ② aynı gün girişi ③ girişi yok; grup içinde saat; eşitlikte daire adı, kimlik.
// ---------------------------------------------------------------------------

const DAY = "2030-01-10";
function job(taskId: string, propertyName: string, arrival: CleaningJob["arrival"], extra: Partial<CleaningJob> = {}): CleaningJob {
  return { taskId, propertyName, dayKey: DAY, assigneeId: "u1", assigneeName: "Ayşe", arrival, ...extra };
}
const ids = (jobs: CleaningJob[]) => jobs.map((j) => j.taskId);

describe("orderDayJobs — sıra kuralı", () => {
  it("girişi en erken olan önce", () => {
    const out = orderDayJobs([
      job("a", "Lale 3", { checkInTime: "16:00", early: null }),
      job("b", "Lale 5", { checkInTime: "14:00", early: null }),
      job("c", "Lale 7", { checkInTime: "15:00", early: null }),
    ]);
    expect(ids(out)).toEqual(["b", "c", "a"]);
  });

  it("erken giriş istenen (saati daha geç olsa da) önce; onaylı erken giriş de bu grupta, kendi saatiyle", () => {
    const out = orderDayJobs([
      job("normal", "Lale 1", { checkInTime: "13:00", early: null }),
      job("istendi", "Lale 2", { checkInTime: "15:00", early: "requested" }),
      job("onayli", "Lale 3", { checkInTime: "11:00", early: "approved" }),
    ]);
    expect(ids(out)).toEqual(["onayli", "istendi", "normal"]);
  });

  it("o gün girişi olmayan (yalnız çıkış) en sona — saati olan ve olmayan girişlerden sonra", () => {
    const out = orderDayJobs([
      job("cikis", "Aaa", null),
      job("saatsiz", "Bbb", { checkInTime: null, early: null }),
      job("saatli", "Ccc", { checkInTime: "20:00", early: null }),
    ]);
    expect(ids(out)).toEqual(["saatli", "saatsiz", "cikis"]);
  });

  it("eşitlikte kararlı: aynı saat → daire adı (kimlik sırasından farklı), aynı ad → görev kimliği; girdi sırası sonucu değiştirmez", () => {
    const input = [
      job("z", "Lale 0", { checkInTime: "14:00", early: null }),
      job("y", "Lale 1", { checkInTime: "14:00", early: null }),
      job("x", "Lale 1", { checkInTime: "14:00", early: null }),
      job("w", "Lale 7", null),
      job("v", "Lale 8", null),
    ];
    const expected = ["z", "x", "y", "w", "v"];
    expect(ids(orderDayJobs(input))).toEqual(expected);
    expect(ids(orderDayJobs([...input].reverse()))).toEqual(expected);
  });

  it("girdiyi değiştirmez (yalnız öneri)", () => {
    const input = [job("b", "Lale 5", null), job("a", "Lale 3", { checkInTime: "12:00", early: null })];
    const copy = JSON.parse(JSON.stringify(input));
    orderDayJobs(input);
    expect(input).toEqual(copy);
  });
});

describe("cleaningDayOrderGroups — kişi / gün grupları", () => {
  it("tek işli grup gösterilmez (aşırı uygulama kontrolü)", () => {
    expect(cleaningDayOrderGroups([job("a", "Lale 3", { checkInTime: "14:00", early: null })])).toEqual([]);
    expect(
      cleaningDayOrderGroups([
        job("a", "Lale 3", { checkInTime: "14:00", early: null }),
        job("b", "Lale 5", { checkInTime: "12:00", early: null }, { assigneeId: "u2", assigneeName: "Mehmet" }),
      ]),
    ).toEqual([]);
  });

  it("aynı kişinin aynı gündeki işleri sıralanır; başka gün / başka kişi ayrı grup; atanmamışlar sonda kendi grubunda", () => {
    const groups = cleaningDayOrderGroups([
      job("a1", "Lale 3", { checkInTime: "16:00", early: null }),
      job("a2", "Lale 5", { checkInTime: "12:00", early: null }),
      job("n1", "Lale 6", null, { assigneeId: null, assigneeName: null }),
      job("n2", "Lale 1", { checkInTime: "14:00", early: null }, { assigneeId: null, assigneeName: null }),
      job("t1", "Lale 3", null, { dayKey: "2030-01-11" }),
      job("t2", "Lale 4", { checkInTime: "10:00", early: null }, { dayKey: "2030-01-11" }),
      job("m1", "Lale 2", null, { assigneeId: "u0", assigneeName: "Ahmet" }),
      job("m2", "Lale 8", { checkInTime: "18:00", early: null }, { assigneeId: "u0", assigneeName: "Ahmet" }),
    ]);
    expect(groups.map((g) => [g.dayKey, g.assigneeName, ids(g.jobs)])).toEqual([
      [DAY, "Ahmet", ["m2", "m1"]],
      [DAY, "Ayşe", ["a2", "a1"]],
      [DAY, null, ["n2", "n1"]],
      ["2030-01-11", "Ayşe", ["t2", "t1"]],
    ]);
  });
});
