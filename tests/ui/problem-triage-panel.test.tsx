// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ProblemTriagePanel, type TriageRow } from "@/components/inbox/problem-triage-panel";

// ---------------------------------------------------------------------------
// m48 — okuma yüzeyi. Panel DETERMİNİSTİK: model çağrısı YOK, yalnız escalation
// anında yazılmış analizi çiziyor.
// ---------------------------------------------------------------------------

const base: TriageRow = {
  id: "c1",
  propertyName: "Lale 3",
  lastMessageAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
  riskType: "complaint",
  actionSuggestion: "Ekibi bugün yönlendirin, fotoğraf isteyin.",
  missingInfo: ["fotoğraf", "hangi oda"],
  source: "model",
  stale: false,
};

describe("ProblemTriagePanel", () => {
  beforeEach(cleanup);

  it("boş listede HİÇ çizilmez (boş bir kutu göstermez)", () => {
    const { container } = render(<ProblemTriagePanel rows={[]} timeZone="Europe/Istanbul" />);
    expect(container.innerHTML).toBe("");
  });

  it("öneri + eksik bilgi + daire adı görünür; konuşmaya bağlantı var", () => {
    render(<ProblemTriagePanel rows={[base]} timeZone="Europe/Istanbul" />);
    expect(screen.getByText(/Ekibi bugün yönlendirin/)).toBeTruthy();
    expect(screen.getByText(/fotoğraf · hangi oda/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Lale 3" });
    expect(link.getAttribute("href")).toBe("/inbox/c1");
  });

  it("🚨 'yalnız kelime eşleşmesi' rozeti YALNIZ keyword kaynağında çizilir", () => {
    // Ölçülmüş gerçek vaka: "Can you send location link. Its not working" →
    // intent `complaint`, çünkü "not working" düz bir kelime eşleşmesi. O yol
    // model çapraz-kontrolü OLMADAN escalate ediyor. Rozet bunu görünür kılıyor.
    render(<ProblemTriagePanel rows={[{ ...base, source: "keyword" }]} timeZone="Europe/Istanbul" />);
    expect(screen.getByText(/Yalnız kelime eşleşmesi/)).toBeTruthy();
    cleanup();
    // KONTROL: model kaynağında rozet YOK — bu olmadan "her zaman göster"
    // mutasyonu da yeşil geçerdi ve rozet anlamsızlaşırdı.
    render(<ProblemTriagePanel rows={[base]} timeZone="Europe/Istanbul" />);
    expect(screen.queryByText(/Yalnız kelime eşleşmesi/)).toBeNull();
  });

  it("bayat rozeti yalnız `stale` olduğunda görünür", () => {
    render(<ProblemTriagePanel rows={[{ ...base, stale: true }]} timeZone="Europe/Istanbul" />);
    expect(screen.getByText(/Bu analizden sonra yeni mesaj geldi/)).toBeTruthy();
    cleanup();
    render(<ProblemTriagePanel rows={[base]} timeZone="Europe/Istanbul" />);
    expect(screen.queryByText(/Bu analizden sonra yeni mesaj geldi/)).toBeNull();
  });

  it("analizsiz satır (kelime yolu) yine ÇİZİLİR — sessizce düşmez", () => {
    // Kelime yolunda analiz alanları NULL. Satırın kaybolması, host'un o
    // konuşmayı hiç görmemesi demek olurdu.
    render(
      <ProblemTriagePanel
        rows={[{ ...base, actionSuggestion: null, missingInfo: [], source: "keyword" }]}
        timeZone="Europe/Istanbul"
      />,
    );
    expect(screen.getByRole("link", { name: "Lale 3" })).toBeTruthy();
    expect(screen.queryByText(/Önerilen adım/)).toBeNull();
  });

  it("etiketsiz riskType 'Diğer' kovasında toplanır (satır KAYBOLMAZ)", () => {
    render(<ProblemTriagePanel rows={[{ ...base, riskType: null }]} timeZone="Europe/Istanbul" />);
    expect(screen.getByText(/Diğer · 1 konuşma/)).toBeTruthy();
  });

  it("aynı riskType'lı satırlar TEK grupta toplanır ve sayaç doğru", () => {
    render(
      <ProblemTriagePanel
        rows={[base, { ...base, id: "c2", propertyName: "Lale 7" }]}
        timeZone="Europe/Istanbul"
      />,
    );
    expect(screen.getByText("2 konuşma")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Lale 7" })).toBeTruthy();
  });
});
