import { describe, it, expect } from "vitest";
import { computeResponseEpisodes } from "@/lib/response-episodes";

// Codex #33 — episode semantics + the SLA contract:
//   answered ≤24h → within · answered >24h → failed · unanswered >24h (@now)
//   → failed · unanswered ≤24h (@now) → PENDING (out of the denominator).
// Both boundaries are 24h-INCLUSIVE.

const T0 = new Date("2026-07-01T10:00:00Z");
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const WINDOW = new Date("2026-06-20T00:00:00Z");
const inb = (at: Date) => ({ direction: "inbound", createdAt: at });
const out = (at: Date) => ({ direction: "outbound", createdAt: at });

describe("computeResponseEpisodes", () => {
  it("counts EVERY episode in a thread, not just the first pair", () => {
    // ep1 answered in 30m; ep2 answered in 25h (late stays late); ep3
    // unanswered and 25h old at NOW → expired → failed.
    const msgs = [
      inb(min(0)), out(min(30)),
      inb(min(100)), out(min(100 + 25 * 60)),
      inb(min(3000)),
    ];
    const now = min(3000 + 25 * 60);
    expect(computeResponseEpisodes(msgs, WINDOW, now)).toEqual({ answerable: 3, answeredWithin24h: 1 });
  });

  it("PENDING: a fresh unanswered question (5 min / 23:59 old) stays OUT of the denominator", () => {
    // Codex red-first: the first cut counted these as instant misses.
    const fiveMin = [inb(min(0))];
    expect(computeResponseEpisodes(fiveMin, WINDOW, min(5))).toEqual({ answerable: 0, answeredWithin24h: 0 });
    const almostDay = [inb(min(0))];
    expect(computeResponseEpisodes(almostDay, WINDOW, min(24 * 60 - 1))).toEqual({
      answerable: 0,
      answeredWithin24h: 0,
    });
  });

  it("EXPIRED: an unanswered run older than 24h counts as failed; exactly 24h is still pending", () => {
    const msgs = [inb(min(0))];
    // Exactly 24h old: an answer landing this instant would still be within → pending.
    expect(computeResponseEpisodes(msgs, WINDOW, min(24 * 60))).toEqual({ answerable: 0, answeredWithin24h: 0 });
    // One minute past → SLA can no longer be met → failed.
    expect(computeResponseEpisodes(msgs, WINDOW, min(24 * 60 + 1))).toEqual({ answerable: 1, answeredWithin24h: 0 });
  });

  it("a late answer (>24h) stays failed even though the episode is completed", () => {
    const msgs = [inb(min(0)), out(min(30 * 60))];
    expect(computeResponseEpisodes(msgs, WINDOW, min(40 * 60))).toEqual({ answerable: 1, answeredWithin24h: 0 });
  });

  it("a run of consecutive guest messages is ONE episode anchored at the FIRST message", () => {
    // Reply lands 24.5h after the FIRST message of the run → late, even though
    // it came 1h after the LAST message.
    const msgs = [inb(min(0)), inb(min(60)), inb(min(23.5 * 60)), out(min(24.5 * 60))];
    expect(computeResponseEpisodes(msgs, WINDOW, min(25 * 60))).toEqual({ answerable: 1, answeredWithin24h: 0 });
  });

  it("pencereden ÖNCE başlayıp ÖNCE kapanan episode sayılmaz, penceredeki sayılır", () => {
    const old = new Date("2026-05-01T10:00:00Z"); // long before WINDOW
    const msgs = [
      inb(old), out(new Date(old.getTime() + 60_000)), // pre-window episode → ignored
      inb(min(0)), out(min(10)), // in-window → counted
    ];
    expect(computeResponseEpisodes(msgs, WINDOW, min(60))).toEqual({ answerable: 1, answeredWithin24h: 1 });
  });

  it("boundary: an answer at exactly 24h is within; outbound-first no-op; empty thread zero", () => {
    expect(computeResponseEpisodes([inb(min(0)), out(min(24 * 60))], WINDOW, min(25 * 60))).toEqual({
      answerable: 1,
      answeredWithin24h: 1,
    });
    expect(computeResponseEpisodes([out(min(0))], WINDOW, min(60))).toEqual({ answerable: 0, answeredWithin24h: 0 });
    expect(computeResponseEpisodes([], WINDOW, min(60))).toEqual({ answerable: 0, answeredWithin24h: 0 });
  });
});

// ---------------------------------------------------------------------------
// PENCEREYE AİTLİK = ÖRTÜŞME (08-08 denetimi, ÖLÇÜLDÜ)
//
// Eski kural yalnız BAŞLANGICA bakıyordu (`runStart >= windowStart`) ve tam da
// SÜREKLİ İHMALİ görünmez kılıyordu: bir misafiri ne kadar uzun bekletirsen açık
// koşu pencere sınırını o kadar kesin aşar ve episode denklemin TAMAMEN dışına
// düşerdi. Yani metrik, en kötü davranışı en cömert şekilde ödüllendiriyordu.
//
// İKİ YÖN DE PİNLİ: pencereye sarkan koşu SAYILMALI (kuralı geri alan mutasyon
// kırmızı) ve pencereden önce KAPANMIŞ episode sayılmaMALI (pencere kontrolünü
// tamamen kaldıran mutasyon kırmızı).
// ---------------------------------------------------------------------------
describe("computeResponseEpisodes — pencere ÖRTÜŞMESİ", () => {
  const before = (h: number) => new Date(WINDOW.getTime() - h * 60 * 60 * 1000);
  const after = (h: number) => new Date(WINDOW.getTime() + h * 60 * 60 * 1000);

  it("pencereden ÖNCE başlayıp pencere İÇİNDE yanıtlanan koşu sayılır (geç olarak)", () => {
    // Misafir pencere açılmadan 50 saat önce sordu, yanıt pencerenin 10. saatinde
    // geldi → 60 saat beklemiş. Eski kod bunu HİÇ görmüyordu.
    const msgs = [inb(before(50)), out(after(10))];
    expect(computeResponseEpisodes(msgs, WINDOW, after(20))).toEqual({
      answerable: 1,
      answeredWithin24h: 0,
    });
  });

  it("pencereden ÖNCE başlayıp HÂLÂ yanıtlanmamış koşu sayılır (SLA çoktan doldu)", () => {
    const msgs = [inb(before(50))];
    expect(computeResponseEpisodes(msgs, WINDOW, after(10))).toEqual({
      answerable: 1,
      answeredWithin24h: 0,
    });
  });

  it("pencereden ÖNCE başlayıp ÖNCE kapanan episode HÂLÂ dışarıda (kural gevşetilmedi)", () => {
    // Yanıt penceresinin 1 ms öncesinde geldi → episode tamamen geçmişte kapandı.
    const closedBefore = [inb(before(50)), out(new Date(WINDOW.getTime() - 1))];
    expect(computeResponseEpisodes(closedBefore, WINDOW, after(10))).toEqual({
      answerable: 0,
      answeredWithin24h: 0,
    });
    // Sınır: TAM pencere anındaki yanıt İÇERİDEDİR (pencere kapsayıcı başlar).
    const closedAtEdge = [inb(before(50)), out(new Date(WINDOW.getTime()))];
    expect(computeResponseEpisodes(closedAtEdge, WINDOW, after(10))).toEqual({
      answerable: 1,
      answeredWithin24h: 0,
    });
  });

  it("ÖLÇÜLEN SENARYO: sürekli ihmal edilen thread artık oranı aşağı çeker", () => {
    // A: pencere içinde sorulmuş ve 1 saatte yanıtlanmış → 1/1.
    const a = computeResponseEpisodes([inb(after(5)), out(after(6))], WINDOW, after(48));
    // B: aynı misafir İKİ kez ihmal edilmiş — ilk koşu pencereden önce başlayıp
    // pencere içinde geç yanıtlanmış, ikincisi hâlâ yanıtsız.
    const b = computeResponseEpisodes(
      [inb(before(30)), out(after(20)), inb(after(21))],
      WINDOW,
      after(48),
    );
    const answerable = a.answerable + b.answerable;
    const within = a.answeredWithin24h + b.answeredWithin24h;
    expect({ answerable, within }).toEqual({ answerable: 3, within: 1 });
    expect(Math.round((within / answerable) * 100)).toBe(33); // eski kod: %100
  });
});
