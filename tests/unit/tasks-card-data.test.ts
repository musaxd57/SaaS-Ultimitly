import { describe, it, expect } from "vitest";
import { taskCardData, type TaskCardRow } from "@/lib/tasks/card-data";

// ---------------------------------------------------------------------------
// Görev panosu kart verisi (sayfanın eşlemesi; kanıt modeli dilim 3): personel oturumunda başlık temizlikçi görünümü,
// temizlik listesi başlığı HER oturumda temizlikçi görünümü (alıcısı temizlikçi). Yönetici kendi başlığını görür.
// ---------------------------------------------------------------------------

const ROW: TaskCardRow = {
  id: "t1",
  title: "Çıkış temizliği - Ayşe Yılmaz",
  type: "cleaning",
  origin: "system",
  priority: "standard",
  status: "todo",
  dueAt: new Date("2026-10-14T00:00:00Z"),
  checklistJson: JSON.stringify([{ label: "Çarşaf", done: false }]),
  property: { name: "Lale" },
  assignedTo: { name: "Temizlik" },
  updates: [{ note: "Erken giriş 13:00 otomatik onaylandı." }],
};
const CTX = { timeZone: "Europe/Istanbul", now: new Date("2026-10-14T08:00:00Z"), latestPhotoUrl: null };

describe("görev kartı — kim neyi görür", () => {
  it("🚨 personel: başlık misafir adı taşımaz; temizlik listesi başlığı da", () => {
    const c = taskCardData(ROW, { ...CTX, canManage: false });
    expect(c.title).toBe("Çıkış temizliği");
    expect(c.shareTitle).toBe("Çıkış temizliği");
    expect(JSON.stringify(c)).not.toContain("Ayşe");
  });

  it("yönetici: panoda kendi başlığı (misafir adıyla), temizlik listesi yine temizlikçi görünümü", () => {
    const c = taskCardData(ROW, { ...CTX, canManage: true });
    expect(c.title).toBe("Çıkış temizliği - Ayşe Yılmaz");
    expect(c.shareTitle).toBe("Çıkış temizliği");
  });

  it("kartın geri kalanı eskisi gibi: tarih, gün farkı, kontrol listesi, son not; bozuk kontrol listesi kartı düşürmez", () => {
    const c = taskCardData(ROW, { ...CTX, canManage: true, latestPhotoUrl: "/api/files/x" });
    expect(c).toMatchObject({
      id: "t1",
      propertyName: "Lale",
      assigneeName: "Temizlik",
      dueDays: 0,
      checklist: { items: [{ label: "Çarşaf", done: false }] },
      latestNote: "Erken giriş 13:00 otomatik onaylandı.",
      latestPhotoUrl: "/api/files/x",
    });
    expect(c.dueLabel).toBeTruthy();
    expect(taskCardData({ ...ROW, checklistJson: '"foo"', dueAt: null, assignedTo: null, updates: [] }, { ...CTX, canManage: true })).toMatchObject({
      checklist: null,
      dueLabel: null,
      dueDays: null,
      assigneeName: null,
      latestNote: null,
    });
  });
});
