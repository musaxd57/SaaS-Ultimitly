// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// H2 düğmesi istemci bileşeni (`useRouter`) — uygulama yönlendiricisi testte yok.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/dashboard" }));
import { AttentionPanel } from "@/components/attention-panel";
import type { AttentionItem } from "@/modules/intelligence/incidents/attention";

// ---------------------------------------------------------------------------
// "Dikkat Gerektirenler" kartı — KARAR PİNLERİ (görsel değil).
//
// 🚨 En önemlisi: SAKİN GÜNDE HİÇ RENDER OLMAZ. Boş durum metni ya da "şu an
// sorun yok" rozeti de YOK — her gün orada duran bir uyarı kartı duvar kâğıdına
// döner ve gerçekten bir şey olduğunda görülmez.
//
// 🚨 İkincisi: ÇIKARIM olan satır kendini çıkarım diye söyler. Tekrar eden
// arıza, kelime ağıyla sınıflandırılmış sinyallerden türüyor (Türkçe olumsuz
// fiil boşluğu ÖLÇÜLMÜŞ bir açık) — kesin tespit gibi sunmak sahte kesinliktir.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const base = {
  propertyId: "p1",
  propertyName: "Deniz Apart",
  occurredAt: new Date("2026-09-09T00:00:00Z"),
};

describe("AttentionPanel", () => {
  it("🚨 BOŞ LİSTEDE HİÇBİR ŞEY BASMAZ (boş durum metni bile yok)", () => {
    const { container } = render(<AttentionPanel items={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("karar kartı satırı: bekleyen karar 'onaylayın ya da reddedin'; gönderimi doğrulanamayan karar 'kanaldan kontrol edin'", () => {
    const items: AttentionItem[] = [
      { ...base, kind: "decision_pending", certainty: "inferred", severity: 92, href: "/inbox/c1", decisionTitle: "13:00 erken giriş" },
      {
        ...base,
        propertyId: "p2",
        propertyName: "Lale",
        kind: "decision_pending",
        certainty: "inferred",
        severity: 92,
        href: "/inbox/c2",
        decisionTitle: "14:00 geç çıkış",
        decisionUnverified: true,
      },
    ];
    render(<AttentionPanel items={items} />);
    expect(screen.getByText("Karar bekliyor: 13:00 erken giriş")).toBeTruthy();
    expect(screen.getByText(/Deniz Apart · onaylayın ya da reddedin/)).toBeTruthy();
    expect(screen.getByText("Gönderim doğrulanamadı: 14:00 geç çıkış")).toBeTruthy();
    expect(screen.getByText(/Lale · konuşmayı kanaldan kontrol edin/)).toBeTruthy();
  });

  it("misafire verilen söz satırı: yaklaşan söz 'söz verildi … kaldı', geciken söz 'gecikti'; tür etiketi ve işletme saati", () => {
    const items: AttentionItem[] = [
      { ...base, kind: "commitment_due", certainty: "observed", severity: 96, href: "/inbox/c1", commitmentKind: "towels", minutesLeft: -30, commitmentTime: "14:30" },
      {
        ...base,
        propertyId: "p2",
        propertyName: "Lale",
        kind: "commitment_due",
        certainty: "observed",
        severity: 89,
        href: "/inbox/c2",
        commitmentKind: "cleaning",
        minutesLeft: 134,
        commitmentTime: "yarın 09:00",
      },
    ];
    render(<AttentionPanel items={items} />);
    expect(screen.getByText("Misafire verilen söz gecikti: Havlu / çarşaf")).toBeTruthy();
    expect(screen.getByText(/Deniz Apart · 14:30 · ilgili görev tamamlanmadı · 30 dk gecikti/)).toBeTruthy();
    expect(screen.getByText("Misafire söz verildi: Temizlik")).toBeTruthy();
    expect(screen.getByText(/Lale · yarın 09:00 · ilgili görev tamamlanmadı · 2 sa 14 dk kaldı/)).toBeTruthy();
  });

  it("söz → görev otomatik (kurucu 10-17 gece): pay içinde 'zamanı geldi'; 1 gün sonra TEK hatırlatma metni (kapatma yok); saatsiz söz saat uydurmadan", () => {
    const row = (minutesLeft: number, commitmentTime: string, propertyId: string, extra: Partial<AttentionItem> = {}): AttentionItem => ({
      ...base,
      propertyId,
      kind: "commitment_due",
      certainty: "observed",
      severity: 89,
      href: `/inbox/${propertyId}`,
      commitmentKind: "towels",
      minutesLeft,
      commitmentTime,
      ...extra,
    });
    // Hatırlatma işaretini SUNUCU koyar (anahtar açık + ≥ 1 gün); panel işarete bakar.
    render(
      <AttentionPanel
        items={[
          row(0, "14:30", "p1"),
          row(-24 * 60, "dün akşam", "p2", { commitmentReminder: true, commitmentPrecise: false }),
          row(-24 * 60 + 1, "dün 15:01", "p3"),
          row(-30 * 60, "dün (saat belirtilmedi)", "p4", { commitmentReminder: true, commitmentPrecise: false }),
          row(-90, "bugün akşam", "p5", { commitmentPrecise: false }),
          row(300, "yarın (saat belirtilmedi)", "p6", { commitmentPrecise: false }),
        ]}
      />,
    );
    expect(screen.getByText(/Deniz Apart · 14:30 · ilgili görev tamamlanmadı · zamanı geldi/)).toBeTruthy();
    // Tam 1 gün → hatırlatma; 1 gün dolmadan → bugünkü "gecikti" metni (eşik pini).
    expect(screen.getAllByText("Söz 1 gündür açık: Havlu / çarşaf")).toHaveLength(2);
    expect(screen.getByText(/dün akşam · yapıldıysa görevi tamamlayın, yapılmayacaksa iptal edin/)).toBeTruthy();
    expect(screen.getByText(/dün \(saat belirtilmedi\) · yapıldıysa görevi tamamlayın/)).toBeTruthy();
    expect(screen.getByText(/dün 15:01 · ilgili görev tamamlanmadı · 23 sa 59 dk gecikti/)).toBeTruthy();
    // Dilim / gün sözünde kalan / geçen süre YAZILMAZ (pencere sonu söylenmez — Opus O12).
    expect(screen.getByText(/bugün akşam · ilgili görev tamamlanmadı · gecikti$/)).toBeTruthy();
    expect(screen.getByText(/yarın \(saat belirtilmedi\) · ilgili görev tamamlanmadı$/)).toBeTruthy();
    expect(screen.queryByText(/1 sa 30 dk gecikti|5 sa kaldı/)).toBeNull();
    expect(screen.getAllByText("Misafire verilen söz gecikti: Havlu / çarşaf")).toHaveLength(2);
  });

  it("kanal bağlantısı satırı: hata türünü sade söyler, 'Tüm daireler' der, sağlayıcı ADI geçmez; bayat okuma gecikme uyarısı", () => {
    const items: AttentionItem[] = [
      { ...base, propertyId: "", propertyName: "", kind: "connection_unhealthy", certainty: "observed", severity: 98, href: "/settings?tab=baglantilar", connectionErrorKind: "auth_revoked", minutesSinceOk: 10 },
      { ...base, propertyId: "", propertyName: "", kind: "connection_unhealthy", certainty: "observed", severity: 98, href: "/settings?tab=baglantilar", minutesSinceOk: 150 },
    ];
    const { container } = render(<AttentionPanel items={items} canManageChannel />);
    expect(screen.getByText("Kanal bağlantısı okunamıyor")).toBeTruthy();
    expect(screen.getByText(/Tüm daireler · bağlantı yetkisi düştü — yeniden bağlanın · kanaldan son başarılı okuma 10 dk önce/)).toBeTruthy();
    expect(screen.getByText("Kanal senkronu gecikiyor")).toBeTruthy();
    expect(screen.getByText(/Tüm daireler · kanaldan son başarılı okuma 2 sa önce · yeni mesajlar gecikebilir/)).toBeTruthy();
    expect(container.textContent ?? "").not.toMatch(/hospitable/i);
    cleanup();
    // Bağlantıyı onaramayan kullanıcı (yönetici) "yeniden bağlanın" görmez.
    const viewer = render(<AttentionPanel items={items.slice(0, 1)} />);
    expect(viewer.container.textContent ?? "").toMatch(/işletme sahibinize bildirin/);
    expect(viewer.container.textContent ?? "").not.toMatch(/yeniden bağlanın/);
  });

  it("bozuk besleme satırı host'a NE ANLAMA GELDİĞİNİ söyler", () => {
    const items: AttentionItem[] = [
      { ...base, kind: "feed_broken", certainty: "observed", severity: 100, href: "/properties/p1", sourceLabel: "Airbnb" },
    ];
    render(<AttentionPanel items={items} />);
    expect(screen.getByText(/Airbnb bağlantısı güncellenemiyor/)).toBeTruthy();
    expect(screen.getByText(/yeni rezervasyon gelmiyor olabilir/)).toBeTruthy();
    // Gözlem → "doğrulayın" uyarısı EKLENMEZ.
    expect(screen.queryByText(/otomatik sınıflandırma/)).toBeNull();
  });

  it("çakışan rezervasyon satırı mülkü, geceleri ve yapılacak şeyi SADE dille söyler", () => {
    const items: AttentionItem[] = [
      {
        ...base,
        kind: "calendar_conflict",
        certainty: "observed",
        severity: 97,
        href: "/calendar?property=p1&month=2026-10",
        nights: { from: "2026-10-05", to: "2026-10-07" },
        possibleDuplicate: false,
      },
    ];
    render(<AttentionPanel items={items} />);
    expect(screen.getByText("Aynı gecelere iki rezervasyon var")).toBeTruthy();
    // Yarı açık [5, 7) = 5 ve 6 Ekim geceleri; 7 Ekim çıkış günüdür, çakışan gece DEĞİL (inceleme 09-24).
    expect(screen.getByText(/Deniz Apart · 5 Eki – 6 Eki geceleri · takvimi kontrol edin/)).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("href")).toBe("/calendar?property=p1&month=2026-10");
    // Müşteriye giden metin teknik terim taşımaz.
    expect(document.body.textContent).not.toMatch(/conflict|overlap|claim|origin|çakışma olgusu/i);
  });

  it("tek gece, talep ve birden çok çakışma kendi sözüyle söylenir; kanıtsız çakışma 'doğrulayın' der (sınıflandırma DEMEZ)", () => {
    const items: AttentionItem[] = [
      {
        ...base,
        kind: "calendar_conflict",
        certainty: "inferred",
        severity: 70,
        href: "/calendar?property=p1&month=2026-10",
        nights: { from: "2026-10-05", to: "2026-10-06" },
        possibleDuplicate: false,
        heldRequest: true,
        conflictCount: 3,
      },
    ];
    render(<AttentionPanel items={items} />);
    expect(screen.getByText("Onay bekleyen bir talep dolu gecelerle çakışıyor")).toBeTruthy();
    expect(screen.getByText(/5 Eki gecesi · 2 çakışma daha · takvimi kontrol edin/)).toBeTruthy();
    expect(screen.getByText(/kayıtlardan biri güncel olmayabilir, doğrulayın/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/otomatik sınıflandırma/);
  });

  it("birebir aynı tarihli çift 'olabilir' diye söylenir — kesin hüküm vermez", () => {
    const items: AttentionItem[] = [
      {
        ...base,
        kind: "calendar_conflict",
        certainty: "observed",
        severity: 45,
        href: "/calendar?property=p1&month=2026-10",
        nights: { from: "2026-10-10", to: "2026-10-12" },
        possibleDuplicate: true,
      },
    ];
    render(<AttentionPanel items={items} />);
    expect(screen.getByText("Aynı rezervasyon iki kez görünüyor olabilir")).toBeTruthy();
  });

  it("cevapsız mesaj satırı BEKLEME SÜRESİNİ yazar", () => {
    const items: AttentionItem[] = [
      { ...base, kind: "unanswered_aging", certainty: "observed", severity: 59, href: "/inbox/c1", hoursWaiting: 9 },
    ];
    render(<AttentionPanel items={items} />);
    expect(screen.getByText(/9 saattir cevapsız/)).toBeTruthy();
  });

  it("🚨 ÇIKARIM satırı kendini ÇIKARIM diye söyler", () => {
    const items: AttentionItem[] = [
      {
        ...base,
        kind: "recurring_issue",
        certainty: "inferred",
        severity: 30,
        href: "/properties/p1",
        category: "hot_water",
        evidenceCount: 4,
      },
    ];
    render(<AttentionPanel items={items} />);
    expect(screen.getByText(/otomatik sınıflandırma, doğrulayın/)).toBeTruthy();
    expect(screen.getByText(/4 sinyal/)).toBeTruthy();
  });

  it("her satır kendi hedefine bağlanır", () => {
    const items: AttentionItem[] = [
      { ...base, kind: "unanswered_aging", certainty: "observed", severity: 59, href: "/inbox/c1", hoursWaiting: 9 },
      { ...base, kind: "feed_broken", certainty: "observed", severity: 100, href: "/properties/p1", sourceLabel: "Airbnb" },
    ];
    render(<AttentionPanel items={items} />);
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/inbox/c1", "/properties/p1"]);
  });

  it("yetim boşluk satırı: gece sayısı + geceler + öneri; TUTAR YOK (kurucu 10-11: gerçek fiyat Airbnb takviminden gelince); kanıtsız komşu 'doğrulayın'", () => {
    const items: AttentionItem[] = [
      { ...base, kind: "booking_gap", certainty: "observed", severity: 35, href: "/calendar?property=p1&month=2026-10", nights: { from: "2026-10-15", to: "2026-10-17" }, gapCount: 2 },
      { ...base, propertyId: "p2", kind: "booking_gap", certainty: "inferred", severity: 20, href: "/calendar?property=p2&month=2026-11", nights: { from: "2026-11-03", to: "2026-11-04" }, gapCount: 1 },
    ];
    render(<AttentionPanel items={items} />);
    expect(screen.getByText("İki konaklama arasında 2 gece boş görünüyor")).toBeTruthy();
    expect(screen.getByText(/Deniz Apart · 15 Eki – 16 Eki geceleri · 1 boşluk daha · kısa konaklamaya açmak isteyebilirsiniz/)).toBeTruthy();
    expect(screen.getByText("İki konaklama arasında 1 gece boş görünüyor")).toBeTruthy();
    expect(screen.getByText(/kayıtlardan biri güncel olmayabilir, doğrulayın/)).toBeTruthy();
    // Tutar satırı YOK — ne "olası gelir" ne "risk altındaki tutar" ne "aralığını ekleyin" çağrısı.
    expect(screen.queryByText(/gelir|Risk altındaki tutar|fiyat aralığını/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// G9 / G10 / H2 (kurucu kararları 10-13): kanal iptal edilmiş rezervasyonu yeniden etkin gösteriyor (+ "yeniden aç" düğmesi yalnız
// sahip / yönetici) · sağlayıcı arızası TEK satır.
// ---------------------------------------------------------------------------
describe("AttentionPanel — aynı konuşma + aynı andaki iki söz (gece-4 S1-15)", () => {
  it("iki söz satırı ayrı anahtar alır: ikisi de görünür, React çift anahtar uyarısı yok", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const row = { ...base, kind: "commitment_due" as const, certainty: "observed" as const, severity: 89, href: "/inbox/c1", commitmentKind: "maintenance" as const, minutesLeft: 30, commitmentTime: "18:00" };
      render(<AttentionPanel items={[{ ...row, rowKey: "cm1", commitmentTopic: "ac" }, { ...row, rowKey: "cm2", commitmentTopic: "faucet" }]} />);
      expect(screen.getAllByText(/18:00/).length).toBeGreaterThanOrEqual(2);
      expect(errors.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
    } finally {
      errors.mockRestore();
    }
  });
});

describe("AttentionPanel — kanal yeniden etkin + sağlayıcı arızası", () => {
  const reactivation: AttentionItem = {
    ...base,
    kind: "channel_reactivation",
    certainty: "observed",
    severity: 85,
    href: "/inbox/c9",
    reservationId: "res-9",
  };

  it("G9 satırı: iptal olarak kaldı, kanaldan kontrol çağrısı", () => {
    render(<AttentionPanel items={[reactivation]} />);
    expect(screen.getByText("Kanal, iptal edilmiş bir rezervasyonu yeniden etkin gösteriyor")).toBeTruthy();
    expect(screen.getByText(/rezervasyon iptal olarak kaldı · kanaldan kontrol edin/)).toBeTruthy();
  });

  it("H2: 'yeniden aç' düğmesi YALNIZ yönetebilen kullanıcıda; bağlantının DIŞINDA", () => {
    const { rerender } = render(<AttentionPanel items={[reactivation]} />);
    expect(screen.queryByRole("button", { name: /yeniden aç/ })).toBeNull();
    rerender(<AttentionPanel items={[reactivation]} canManageReservations />);
    const btn = screen.getByRole("button", { name: /yeniden aç/ });
    expect(btn.closest("a")).toBeNull();
  });

  it("H2: başka satır türünde düğme yok (yönetebilen kullanıcıda da)", () => {
    render(
      <AttentionPanel
        items={[{ ...base, kind: "unanswered_aging", certainty: "observed", severity: 60, href: "/inbox/c1", hoursWaiting: 7 }]}
        canManageReservations
      />,
    );
    expect(screen.queryByRole("button", { name: /yeniden aç/ })).toBeNull();
  });

  it("G10: sağlayıcı arızası tek satır, bekleyen sayısı ve 'iletilmiş olabilir' uyarısı", () => {
    render(
      <AttentionPanel
        items={[{ ...base, propertyId: "", propertyName: "", kind: "provider_outage", certainty: "observed", severity: 97, href: "/inbox", waitingCount: 12 }]}
      />,
    );
    expect(screen.getByText("Kanal sağlayıcısında arıza — 12 mesaj bekliyor")).toBeTruthy();
    expect(screen.getByText(/mesajlar iletilmiş olabilir · elle yanıtlamadan önce konuşmaları kanaldan kontrol edin/)).toBeTruthy();
  });
});
