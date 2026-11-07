// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ArrivalsList, type ArrivalsListRow } from "@/components/arrivals/arrivals-list";

// ---------------------------------------------------------------------------
// "Girişler" görünümü (kurucu H1 / H-2, 11-05): genel durum etiketi ("HAZIR" yok), faktör cümlesi, eksik şart yalnız engel /
// bilinmeyen faktörde, boş liste ve sığmayan giriş sayısı söylenir (sessiz kesme yok).
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

const row = (over: Partial<ArrivalsListRow> = {}): ArrivalsListRow => ({
  reservationId: "r1",
  propertyId: "p1",
  propertyName: "Lale 5",
  guestName: "Misafir",
  dayKey: "2026-11-07",
  dayLabel: "Bugün · 7 Kasım Cumartesi",
  checkInTime: "15:00",
  conversationId: "c1",
  overall: "not_ready",
  factors: [
    { key: "cleaning", state: "blocking", label: "Temizlik açık · atanan: Ayşe · başlanmadı", missing: 'çıkıştan (11:00) sonra "bitti" kaydı', basis: [] },
    { key: "access", state: "info", label: "Giriş talimatı bilgi tabanında yok · erişim kontrol edilmedi", missing: "giriş talimatı ve erişim kontrolü", basis: [] },
  ],
  ...over,
});

describe("Girişler listesi — görünüm", () => {
  it("genel durum + faktör cümlesi; eksik şart yalnız ENGEL / BİLİNMEYEN faktörde (bilgi satırında değil)", () => {
    render(<ArrivalsList rows={[row()]} truncated={0} />);
    expect(screen.getByText("HAZIR DEĞİL")).toBeTruthy();
    expect(screen.getByText("Temizlik açık · atanan: Ayşe · başlanmadı")).toBeTruthy();
    expect(screen.getByText(/eksik: çıkıştan \(11:00\) sonra "bitti" kaydı/)).toBeTruthy();
    expect(screen.queryByText(/eksik: giriş talimatı/)).toBeNull();
    expect(screen.getByRole("link", { name: "Konuşma" }).getAttribute("href")).toBe("/inbox/c1");
    // Görevler bağlantısı O DAİRENİN görevlerine süzülü açılır (satırdaki görev dayanakları orada).
    expect(screen.getByRole("link", { name: "Görevler" }).getAttribute("href")).toBe("/tasks?propertyId=p1");
  });

  it("🚨 'HAZIR' etiketi hiçbir durumda çizilmez — en iyisi 'TEMİZLİK HAZIR'", () => {
    render(
      <ArrivalsList
        rows={[
          row({ reservationId: "a", overall: "cleaning_ready" }),
          row({ reservationId: "b", overall: "unknown" }),
          row({ reservationId: "c", overall: "not_ready" }),
        ]}
        truncated={0}
      />,
    );
    expect(screen.getByText("TEMİZLİK HAZIR")).toBeTruthy();
    expect(screen.getByText("BİLİNMİYOR")).toBeTruthy();
    expect(screen.queryByText(/^HAZIR$/)).toBeNull();
  });

  it("🚨 Opus 11-06 N5 / H-2: erişim satırı GİZLENMEZ; Ayrıntılar'a yalnız bağlam (önceki çıkış → giriş, düşük öncelikli bakım) iner", () => {
    const r = row({
      factors: [
        ...row().factors,
        { key: "timing", state: "info", label: "Önceki çıkış 11:00 → giriş 15:00", missing: null, basis: [] },
        { key: "issue", state: "info", label: "Bakım açık: Dolap kulpu · düşük öncelik", missing: null, basis: [] },
      ],
    });
    const { container } = render(<ArrivalsList rows={[r]} truncated={0} />);
    const details = container.querySelector("details")!;
    expect(details.querySelector("summary")!.textContent).toBe("Ayrıntılar (2)");
    expect(details.textContent).toContain("Önceki çıkış 11:00");
    expect(details.textContent).toContain("Dolap kulpu");
    expect(details.textContent).not.toContain("Giriş talimatı");
    expect(details.textContent).not.toContain("Temizlik açık");
    expect(details.open).toBe(false);
    expect(screen.getByText("Giriş talimatı bilgi tabanında yok · erişim kontrol edilmedi")).toBeTruthy();
  });

  it("🚨 Opus 11-06 N5: temizlikçinin notu ve açık misafir ihtiyacı (bilgi satırları) HEP görünür — 'TEMİZLİK HAZIR' yanında gizlenmez", () => {
    const r = row({
      overall: "cleaning_ready",
      factors: [
        { key: "cleaning", state: "ok", label: "Temizlik bitti 12:40 · Ayşe · çıkıştan (11:00) sonra", missing: null, basis: [] },
        { key: "cleaning_note", state: "info", label: "Temizlik görevine not yazıldı · Ayşe · 12:45 — görevde okuyun", missing: null, basis: [] },
        { key: "need", state: "info", label: "Açık ihtiyaç: Bebek yatağı (sizde)", missing: null, basis: [] },
      ],
    });
    const { container } = render(<ArrivalsList rows={[r]} truncated={0} />);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("Temizlik görevine not yazıldı · Ayşe · 12:45 — görevde okuyun")).toBeTruthy();
    expect(screen.getByText("Açık ihtiyaç: Bebek yatağı (sizde)")).toBeTruthy();
  });

  it("mutasyon Q26: BİLİNMEYEN satır dışarıda (hep görünür); temizlik satırı da", () => {
    const r = row({
      overall: "unknown",
      factors: [
        { key: "cleaning", state: "ok", label: "Temizlik bitti 12:40 · Ayşe · çıkıştan (11:00) sonra", missing: null, basis: [] },
        { key: "issue", state: "unknown", label: "Bakım açık: Banyo lambası · tarihsiz — bu girişi etkiliyor mu?", missing: "görevin kapanması ya da bu güne tarihlenmesi", basis: [] },
      ],
    });
    const { container } = render(<ArrivalsList rows={[r]} truncated={0} />);
    expect(container.querySelector("details")).toBeNull();
    expect(screen.getByText("Temizlik bitti 12:40 · Ayşe · çıkıştan (11:00) sonra")).toBeTruthy();
    expect(screen.getByText("Bakım açık: Banyo lambası · tarihsiz — bu girişi etkiliyor mu?")).toBeTruthy();
  });

  it("engel / bilinmeyen yoksa temizlik satırı (durum ve kim) dışarıda kalır", () => {
    const ok = row({
      overall: "cleaning_ready",
      factors: [
        { key: "cleaning", state: "ok", label: "Temizlik bitti 12:40 · Ayşe · çıkıştan (11:00) sonra", missing: null, basis: [] },
        { key: "timing", state: "info", label: "Önceki çıkış 11:00 → giriş 15:00", missing: null, basis: [] },
      ],
    });
    const { container } = render(<ArrivalsList rows={[ok]} truncated={0} />);
    const details = container.querySelector("details")!;
    expect(details.textContent).toContain("Önceki çıkış 11:00");
    expect(details.textContent).not.toContain("Temizlik bitti");
    expect(screen.getByText("Temizlik bitti 12:40 · Ayşe · çıkıştan (11:00) sonra")).toBeTruthy();
  });

  it("günlere göre gruplanır; boş liste ve sığmayan giriş sayısı söylenir", () => {
    const { unmount } = render(
      <ArrivalsList rows={[row({ reservationId: "a" }), row({ reservationId: "b", dayKey: "2026-11-08", dayLabel: "Yarın · 8 Kasım Pazar" })]} truncated={3} />,
    );
    expect(screen.getByRole("region", { name: "Bugün · 7 Kasım Cumartesi" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Yarın · 8 Kasım Pazar" })).toBeTruthy();
    expect(screen.getByText("Ayrıca 3 giriş daha var; liste ilk 2 girişi gösteriyor.")).toBeTruthy();
    unmount();
    render(<ArrivalsList rows={[]} truncated={0} />);
    expect(screen.getByText("Bugün ve sonraki iki günde giriş yok.")).toBeTruthy();
  });
});
