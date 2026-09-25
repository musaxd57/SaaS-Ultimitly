import { describe, expect, it } from "vitest";
import { timeCorrectedInMessage, timeStatedInMessage } from "@/lib/ai/stated-time";
import { ATTACK_PROBES, BATTERY } from "../helpers/stated-time-blind-battery-2026-09-25";

// ---------------------------------------------------------------------------
// KÖR SAAT BATARYASI — regresyon pini (dilim #161b, 09-25). Ajan bataryayı kodu okumadan yazdı; ilk koşu (tartışmasız
// etiketler): yanlış KABUL 67/407, yanlış RED 55/318; saldırgan sondalarda 51/74 yanlış. #161b sonrası: yanlış kabul 1,
// yanlış red 19, sonda 2 (ikisi de red — güvenli yön). Yanlış kabul misafirin çıkış saati diye REZERVASYONA yazılır; red
// yalnız kaydı atlar. Batarya bu dilimde AYAR İÇİN kullanıldı, bu yüzden kör ölçüm değil; bilinen sınırlar ayrı pinli,
// davranışları değişirse görünür. Tartışmalı etiketli çiftler (ajanın kendi "?" işareti) pinlenmez.
// ---------------------------------------------------------------------------

/** Ürünün kabul kuralı (`ai/index.ts`): yazılan saat kanıtı ya da kayıtlı saatin düzeltmesi. */
const accepted = (t: string, msg: string, prev?: string) =>
  timeStatedInMessage(t, msg) || (!!prev && timeCorrectedInMessage(prev, t, msg));

/** "Sabah erkenden, 6'da çıkıyoruz" — gün dilimi sözcüğü virgülün ÖTEKİ cümleciğinde; 18:00 okunuşu kalıyor. */
const KNOWN_FALSE_ACCEPT = new Set(["T029 18:00"]);
/**
 * Bugün okunmayan beyanlar (red = kayıt yok, güvenli yön): çeyrek / "half past" / sözle saat ("on birde", "halb elf"),
 * bitişik "1030", soru-cevap ayrı cümlede ("Kaçta mı çıkıyoruz? 11'de."), "teslim ederiz daireyi", "like 7am" cümlecik
 * atlaması, düzeltmede kayıtlı saati adlandırmayan biçimler ("Not 10, more like 10:45").
 */
const KNOWN_FALSE_REJECT = new Set([
  "CE009 10:45", "CE019 11:45", "D004 10:30", "E018 10:30", "E019 11:00", "E029 06:00", "E038 10:30", "E039 11:15",
  "E040 10:45", "E078 07:00", "T018 10:30", "T038 11:00", "T039 10:30", "T040 11:00", "T065 10:45", "T066 10:15",
  "T071 11:00", "T072 10:30", "T209 10:00",
]);

const pairs = BATTERY.flatMap((c) =>
  c.cands.filter((x) => !x.debatable).map((x) => ({ key: `${c.id} ${x.t}`, label: x.label, msg: c.msg, prev: c.prev })),
);

describe("kör saat bataryası (09-25) — regresyon pini", () => {
  it("anti-vakum: batarya ve bilinen sınırlar beklenen boyutta", () => {
    expect(BATTERY).toHaveLength(477);
    expect(pairs).toHaveLength(725);
    for (const k of [...KNOWN_FALSE_ACCEPT, ...KNOWN_FALSE_REJECT]) expect(pairs.some((p) => p.key === k), k).toBe(true);
  });

  it.each(pairs.map((p) => [p.key, p.label, p.msg, p.prev ?? ""] as const))("%s %s: %s", (key, label, msg, prev) => {
    const known = KNOWN_FALSE_ACCEPT.has(key) || KNOWN_FALSE_REJECT.has(key);
    const expected = (label === "MUST_ACCEPT") !== known;
    expect(accepted(key.slice(key.indexOf(" ") + 1), msg, prev || undefined)).toBe(expected);
  });
});

/** Saldırgan sondalardan bugün okunmayan iki beyan (red, güvenli yön). */
const ATTACK_KNOWN_FALSE_REJECT = new Set(["We'll leave so early, like 7am. 07:00", "Çıkış için 10'da hazırız. 10:00"]);
const probes = Object.entries(ATTACK_PROBES).flatMap(([group, list]) =>
  list.map(([msg, t, exp, prev]) => ({ group, msg, t, exp, prev, key: `${msg} ${t}` })),
);

describe("kör saat bataryası (09-25) — saldırgan sondalar", () => {
  it("anti-vakum", () => {
    expect(probes).toHaveLength(74);
    for (const k of ATTACK_KNOWN_FALSE_REJECT) expect(probes.some((p) => p.key === k), k).toBe(true);
  });

  it.each(probes.map((p) => [p.group, p.exp, p.t, p.msg, p.prev ?? "", p.key] as const))(
    "%s — %s %s: %s",
    (_group, exp, t, msg, prev, key) => {
      const expected = (exp === "A") !== ATTACK_KNOWN_FALSE_REJECT.has(key);
      expect(accepted(t, msg, prev || undefined)).toBe(expected);
    },
  );
});

// ---------------------------------------------------------------------------
// SON GÖZDEN GEÇİRME (#161b): bataryada OLMAYAN ikizler — İngilizce "part" Fransızca ipucu değildir; soru kalıbı yalnız
// cümlecik BAŞINDA ("…as it is the checkout time" soru değil); süre saat değildir ("dans 2h30"); "11h30" içindeki "11"
// çıplak saat değildir; gezi hedefi yalnız sözcük BAŞINDA ("Otoparka" bir gezi değil).
// ---------------------------------------------------------------------------
const REVIEW_TWINS: [msg: string, t: string, expected: boolean][] = [
  ["Part two of the tour starts at 10.", "10:00", false],
  ["The best part: at 10 we go to the museum.", "10:00", false],
  ["On part à 11h.", "11:00", true],
  ["Je pars à 10h demain.", "10:00", true],
  ["We leave at 11 as it is the checkout time.", "11:00", true],
  ["Hello can we leave at 12?", "12:00", false],
  ["Nous partirons dans 2h30.", "02:30", false],
  ["Nous partirons à 11h30.", "11:30", true],
  ["Nous partirons à 11h30.", "11:00", false],
  ["Otoparka 10'da gidiyoruz.", "10:00", true],
  ["Plaja 10'da gidiyoruz.", "10:00", false],
  ["Denize 11'de çıkıyoruz.", "11:00", false],
  // Gezi kalıbı en fazla TEK ara belirteç geçer: ulaçla ayrılmış gerçek beyan yutulmaz.
  ["Denize girip 11'de çıkarız.", "11:00", true],
  ["Wir checken um 11 Uhr aus.", "11:00", true],
  // Soru işaretiyle biten cümlenin son cümleciği soru (parçacık olmasa da) — ileri bakışta da.
  ["Geç çıkış 13:00 gibi?", "13:00", false],
  ["Yarın çıkıyoruz, saat 10 gibi?", "10:00", false],
  // Önceki beyanın aktarımı: yeni saatli beyan varsa eski saat düşer (ileri bakışla gelen beyan da sayılır); yoksa teyittir.
  ["11'de çıkarız demiştim; yarın çıkıyoruz, saat 9 gibi.", "11:00", false],
  ["11'de çıkarız demiştim; yarın çıkıyoruz, saat 9 gibi.", "09:00", true],
  ["11'de çıkarız demiştim, aynen geçerli.", "11:00", true],
  // Gün dilimi sayının ARDINDA: "tomorrow morning", "at night", "7h du soir", "7 Uhr abends".
  ["We leave at 7 tomorrow morning.", "19:00", false],
  ["We leave at 11 at night.", "23:00", true],
  ["We leave at 11 at night.", "11:00", false],
  ["Nous partirons à 7h du soir.", "19:00", true],
  ["Nous partirons à 7h du soir.", "07:00", false],
  ["Wir reisen um 7 Uhr abends ab.", "19:00", true],
  ["Wir reisen um 7 Uhr abends ab.", "07:00", false],
  // "a.m." noktaları cümle bölücüsüne takılmaz.
  ["Leaving at 6 a.m. sharp.", "18:00", false],
  ["At 10 a.m. we'll check out.", "10:00", true],
  ["Départ 10h demain.", "10:00", true],
  // İngilizce "group" ulaç değildir (cümlecik bölünmez).
  ["At 10 our group leaves.", "10:00", true],
  // Başka aracın kalkışı: yalnız 3. tekil fiil ("tren istasyonuna gidiyoruz" ayrılmadır).
  ["Trenimiz 10'da gidiyor, biz 9'da çıkarız.", "10:00", false],
  ["Tren istasyonuna 10'da gidiyoruz.", "10:00", true],
  ["Notre vol part à 15h, nous partirons à 11h.", "15:00", false],
  // "-ınca" cümlecik ayırıcısı DEĞİL (ölçüldü: bataryada gereksiz; "taksi gelince çıkarız" çıkış saatini taşır).
  ["Taksi 9'da gelince çıkarız.", "09:00", true],
];

describe("kör saat bataryası — son gözden geçirme ikizleri", () => {
  it.each(REVIEW_TWINS)("%s → %s = %s", (msg, t, expected) => {
    expect(timeStatedInMessage(t, msg)).toBe(expected);
  });
});

/** Düzeltme yolu: olay ADI nötrlemeden önceki cümleden okunur; soru cümleciğindeki yeni saat düzeltme değildir. */
const REVIEW_CORRECTION_TWINS: [msg: string, prev: string, next: string, expected: boolean][] = [
  ["Our flight leaves at 13:00 instead of 11.", "11:00", "13:00", false],
  ["10 yerine 11?", "10:00", "11:00", false],
  ["10 demiştim ama 11 olacak.", "10:00", "11:00", true],
];

describe("kör saat bataryası — düzeltme yolu ikizleri", () => {
  it.each(REVIEW_CORRECTION_TWINS)("%s (%s → %s) = %s", (msg, prev, next, expected) => {
    expect(accepted(next, msg, prev)).toBe(expected);
  });
});
