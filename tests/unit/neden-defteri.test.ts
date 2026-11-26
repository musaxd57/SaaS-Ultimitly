import { describe, expect, it } from "vitest";
import { scoreNeeds, needMetrics, type NeedSpec } from "../eval/need-scoring";
import {
  defteriAyristir,
  dosyadanSatirlar,
  girdiyiOku,
  istekEsle,
  kosuToplamlari,
  ozetMetni,
  parcaKimlikleri,
  yanlisDali,
  yeniSatirlar,
} from "../../scripts/neden-defteri-core.mjs";

// ---------------------------------------------------------------------------
// NEDEN DEFTERİ — saf çekirdek (kurucu 11-26: "en ufak gitmeme nedeni hatanın sebeplerini tut bir dosyada biriksin datalar").
// Girdi elle yazılmış küçük bir ayrıntı dosyası; ihtiyaç işaretleri ÖLÇERİN KENDİ puanlayıcısıyla (`scoreNeeds`) üretilir — defterin sonuç
// sayımı ile ölçer raporunun sayımı aynı cetvelden okunsun (iki kopya ayrışırsa defter başka bir şeyi sayar).
// Fikstürler kurgusal ("Lale"); setin dosya adı yok.
// ---------------------------------------------------------------------------

type Item = { kind: string; status: string };
type Scn = { id: string; message: string; needs?: NeedSpec[]; autoSend?: "yes" | "no" | "any" };

function row(s: Scn, r: Record<string, unknown> & { sentText?: string | null; items?: Item[] }) {
  const sentText = r.sentText ?? null;
  const items = r.items ?? [];
  const result: Record<string, unknown> = {
    id: s.id,
    cls: "control",
    lang: "tr",
    expectAuto: s.autoSend ?? "any",
    ok: true,
    sent: sentText !== null,
    sentText,
    draft: r.draft ?? sentText,
    skippedReason: null,
    gateDetail: null,
    riskReason: sentText ? "gate_passed" : "low_confidence_or_risky",
    status: sentText ? "answered" : "new",
    escalated: false,
    trace: { guest: s.message, kb: "std", evidence: { g: { lx: [] }, ir: { v: "-", ev: "-", k: "-" }, sc: { v: "-" } }, declared: null },
    langOk: null,
    model: null,
    ...r,
  };
  delete result.items;
  if (s.needs) {
    result.needs = scoreNeeds(s.needs, sentText, items);
    result.itemStates = items;
    if (!("parts" in r)) result.parts = null;
    result.absenceLeak = false;
  }
  return { scenario: { id: s.id, class: "control", lang: "tr", kb: "std", message: s.message, expect: { autoSend: s.autoSend ?? "any", ...(s.needs ? { needs: s.needs } : {}) } }, result };
}

const wifi: NeedSpec = { kind: "wifi", want: "answered", all: ["lale2024"], forbid: [] };
const parking: NeedSpec = { kind: "parking", want: "answered", all: ["ücretsiz"], forbid: [], about: ["otopark|park"] };
const sauna: NeedSpec = { kind: "amenities", want: "open", all: [], forbid: ["sauna"] };
const pets: NeedSpec = { kind: "pets", want: "open", all: [], forbid: ["köpek|evcil"] };

function detail(rows: ReturnType<typeof row>[]) {
  return {
    suite: "live-pipeline-sealed-detail",
    version: 1,
    meta: { set: "yanmis-5", model: "gpt-x", commit: "abc1234", status: "GEÇERLİ" },
    property: { name: "Lale" },
    kbSets: {},
    rows,
    runtime: { commit: "abc1234", flags: { AI_ANSWER_PARTS_ENABLED: "1", AI_NO_SOURCE_RULE_ENABLED: "(boş)", KB_RETRIEVAL_MODE: "", AI_X: "0", OPENAI_MODEL_TIER: "b" } },
  };
}

const FILE = "live-pipeline-2026-11-26-gpt-x-kor-deneme-ayrinti.json";

const rows = [
  // 1 doğru gitti
  row({ id: "d1", message: "Wi-Fi şifresi?", needs: [wifi] }, { sentText: "Şifre lale2024.", items: [{ kind: "wifi", status: "answered" }] }),
  // 2 gereksiz tutma — çıktı kapısı (parça kipi kapalı)
  row({ id: "t1", message: "Wi-Fi şifresi?", needs: [wifi] }, { skippedReason: "low_confidence_or_risky", gateDetail: "reply_absence", items: [{ kind: "wifi", status: "open" }] }),
  // 3 yanlış gitti — konu var, değer yok (öğe başka türde)
  row({ id: "y1", message: "Otopark ücretli mi?", needs: [parking] }, { sentText: "Otopark günlük 150 TL.", items: [{ kind: "amenities", status: "answered" }] }),
  // 4 açık kalmalıyken cevaplandı — yasak desen
  row({ id: "a1", message: "Sauna var mı?", needs: [sauna] }, { sentText: "Sitede sauna var.", items: [{ kind: "amenities", status: "answered" }] }),
  // 5 açık kalmalıyken cevaplandı — metin sessiz ama öğe kapandı
  row({ id: "a2", message: "Sauna var mı? Wi-Fi?", needs: [wifi, sauna] }, {
    sentText: "Şifre lale2024.",
    items: [{ kind: "wifi", status: "answered" }, { kind: "amenities", status: "answered" }],
  }),
  // 6 parça kipi: evcil hayvan ev sahibinde (numara almaz), Wi-Fi parçası doğrulandı ama tur kapısı tuttu; otopark polarity
  row({ id: "p1", message: "Köpek gelebilir mi? Wi-Fi? Otopark?", needs: [pets, wifi, parking] }, {
    skippedReason: "low_confidence_or_risky",
    gateDetail: "reply_pet_policy",
    items: [{ kind: "pets", status: "pending_host" }, { kind: "wifi", status: "open" }, { kind: "parking", status: "open" }],
    requestsRaw: [[{ intent: "pets" }, { intent: "wifi" }, { intent: "parking" }]],
    parts: [{ ref: "R1", status: "verified" }, { ref: "R2", status: "rejected", issues: ["polarity_mismatch"], advisory: ["subject_missing"] }],
    partsRaw: [[{ ref: "R1", status: "answered", text: "Şifre lale2024." }, { ref: "R2", status: "answered", text: "Ücretsiz sokak parkı var, kapalı otopark yok." }]],
  }),
  // 7 parça kipi: metin gitti, değer yok — okuyucu tuttu (ham hükümle); sauna parçası no_info (doğru açık)
  row({ id: "p2", message: "Wi-Fi? Otopark? Sauna?", needs: [wifi, parking, sauna] }, {
    sentText: "Şifre lale2024.",
    items: [{ kind: "wifi", status: "answered" }, { kind: "parking", status: "open" }, { kind: "amenities", status: "open" }],
    requestsRaw: [[{ intent: "wifi" }, { intent: "parking" }, { intent: "amenities" }]],
    parts: [{ ref: "R1", status: "verified" }, { ref: "R2", status: "rejected", issues: ["reader_binding"] }, { ref: "R3", status: "no_info" }],
    readerRaw: [[{ ref: "R2", answers_request: "yes", supported_by_notes: true, binding_ok: false, exception_without_rule: false, only_known_case: false, quote: "ücretsiz" }]],
  }),
  // 8 sebep okunamıyor: tur gitmedi, kapı ayrıntısı yok, genel risk kodu
  row({ id: "b1", message: "Wi-Fi?", needs: [wifi] }, { skippedReason: "low_confidence_or_risky", items: [{ kind: "wifi", status: "open" }] }),
  // 9 geç mesaj turu açılmadı
  row({ id: "l1", message: "Wi-Fi?", needs: [wifi] }, { skippedReason: "already_answered", riskReason: null, items: [] }),
  // 10 ihtiyacı olmayan senaryo: gitmemesi beklenen tur tutuldu
  row({ id: "s1", message: "Ödeme iade edilsin.", autoSend: "no" }, { skippedReason: "low_confidence_or_risky", gateDetail: "model_intent", model: { intent: "refund", riskLevel: "high", riskType: null, confidence: 0.9 } }),
];
// 11 düşen satır (toplamlara girmez)
const dropped = row({ id: "x1", message: "Wi-Fi?", needs: [wifi] }, { items: [] });
dropped.result.ok = false;
dropped.result.error = "TypeError";
rows.push(dropped);

type Line = Record<string, unknown> & { ayrinti: string; kanit?: string; olcerSuphesi: string[]; bayraklar?: string[] };
const lines = dosyadanSatirlar(detail(rows), FILE) as unknown as Line[];
const need = (id: string, kind: string) => lines.find((l) => l.senaryo === id && l.ihtiyacTuru === kind);

describe("neden defteri — satır üretimi", () => {
  it("koşu başlık satırı: etiket dosya adından, açık bayraklar (boş / (boş) / 0 elenir), set türü etiketten", () => {
    const k = lines[0];
    expect(k).toMatchObject({ birim: "kosu", kosu: "2026-11-26-gpt-x-kor-deneme", tarih: "2026-11-26", commit: "abc1234", model: "gpt-x", setTuru: "dayanak-kabul" });
    expect(k.bayraklar).toEqual(["AI_ANSWER_PARTS_ENABLED", "OPENAI_MODEL_TIER=b"]);
  });

  it("her sonuç sınıfı ve sebebi", () => {
    expect(need("d1", "wifi")).toMatchObject({ sonuc: "dogru_gitti", katman: null, sebep: null, beklenen: "cevaplanmali" });
    expect(need("t1", "wifi")).toMatchObject({ sonuc: "gereksiz_tutuldu", katman: "cikti_kapisi", sebep: "reply_absence" });
    expect(need("y1", "parking")).toMatchObject({ sonuc: "yanlis_gitti", katman: "cevap_modeli", sebep: "konu_var_deger_yok" });
    expect(need("a1", "amenities")).toMatchObject({ sonuc: "acik_kalmaliyken_cevaplandi", sebep: "yasak_desen_gitti", beklenen: "acik_kalmali" });
    expect(need("a2", "amenities")).toMatchObject({ sonuc: "acik_kalmaliyken_cevaplandi", sebep: "oge_yanlis_kapandi" });
    expect(need("a2", "amenities")!.olcerSuphesi).toContain("metin_sessiz_is_kapandi");
  });

  it("parça kipi: ev sahibine bırakılan öğe numara almaz; doğrulanmış parçanın tutulan turu kapıdan; reddedilen parça kendi koduyla", () => {
    expect(need("p1", "pets")).toMatchObject({ sonuc: "dogru_acik_kaldi", katman: "oge_kapisi", sebep: "oge_ev_sahibinde", istek: { ref: null, tur: "pets" } });
    expect(need("p1", "wifi")).toMatchObject({ sonuc: "gereksiz_tutuldu", katman: "cikti_kapisi", sebep: "reply_pet_policy", istek: { ref: "R1", parca: "verified" } });
    expect(need("p1", "parking")).toMatchObject({ katman: "parca_dogrulama", sebep: "polarity_mismatch", istek: { ref: "R2", parca: "rejected" } });
    expect(need("p1", "parking")!.ayrinti).toContain("subject_missing");
    expect(need("p1", "parking")!.kanit).toContain("parça: \"Ücretsiz sokak parkı");
  });

  it("parça kipi: metin gitti değer yok → okuyucu (ham hüküm ayrıntıda); no_info parçası açık kalan ihtiyacın mekanizması", () => {
    const p = need("p2", "parking")!;
    expect(p).toMatchObject({ sonuc: "metin_gitti_deger_yok", katman: "okuyucu", sebep: "reader_binding" });
    expect(p.ayrinti).toContain("bag_dogru=false");
    expect(p.olcerSuphesi).toContain("atlandi_mi_yanlis_mi_ayirt_edilemez");
    expect(need("p2", "amenities")).toMatchObject({ sonuc: "dogru_acik_kaldi", katman: "cevap_modeli", sebep: "parca_no_info" });
  });

  it("sebep okunamıyorsa uydurulmaz: bilinmiyor + hangi alanın eksik olduğu", () => {
    const b = need("b1", "wifi")!;
    expect(b).toMatchObject({ sonuc: "gereksiz_tutuldu", katman: "bilinmiyor", sebep: "bilinmiyor" });
    expect(b.ayrinti).toMatch(/gateDetail -/);
    expect(b.ayrinti).toMatch(/riskReason low_confidence_or_risky/);
  });

  it("geç mesaj turu açılmadı · ihtiyacı olmayan senaryo · düşen satır", () => {
    expect(need("l1", "wifi")).toMatchObject({ katman: "tur_kapisi", sebep: "already_answered" });
    expect(lines.find((l) => l.senaryo === "s1")).toMatchObject({ birim: "senaryo", beklenen: "gitmemeli", sonuc: "dogru_tutuldu", katman: "cevap_modeli", sebep: "model_intent" });
    expect(lines.find((l) => l.senaryo === "x1")).toMatchObject({ sonuc: "olculmedi", katman: "olcer", sebep: "TypeError" });
  });

  it("kanıt ≤ 200 karakter; setin dosya adı hiçbir satırda yok", () => {
    for (const l of lines) if (l.kanit) expect(Array.from(l.kanit).length).toBeLessThanOrEqual(200);
    const all = JSON.stringify(lines);
    for (const n of ["needs-blind", "needs-kabul", "held-pet", "late-message", "grounding-kabul"]) expect(all).not.toContain(n);
  });
});

describe("neden defteri — toplamlar ölçerin cetveliyle aynı", () => {
  it("doğru · tutma · yanlış · açık = needMetrics (düşen satır hariç)", () => {
    const all = rows.filter((r) => r.result.ok && r.result.needs).flatMap((r) => r.result.needs as ReturnType<typeof scoreNeeds>);
    const m = needMetrics(all);
    const [t] = kosuToplamlari(lines);
    expect({ d: t.dogru, h: t.tutma, sm: t.metinGittiDegerYok, w: t.yanlis, o: t.acikOk, ot: t.acik, a: t.cevaplanmali }).toEqual({
      d: m.answeredOk,
      h: m.needlessHold,
      sm: m.sentMissing,
      w: m.wrong,
      o: m.openOk,
      ot: m.open,
      a: m.answered,
    });
  });

  it("yanlış dalı ölçerin dallarından biri: scoreNeeds 'yanlış' dediği her durumda dal 'bilinmiyor' değil", () => {
    const cases: [NeedSpec[], string, Item[]][] = [
      [[parking], "Otopark ücretli.", []],
      [[sauna], "Sauna var.", []],
      [[sauna], "Merhaba.", [{ kind: "amenities", status: "answered" }]],
      [[wifi], "Merhaba.", [{ kind: "wifi", status: "answered" }]],
      [[{ kind: "amenities", want: "answered", all: ["20:00", "22:00"] }, { kind: "amenities", want: "answered", all: ["09:00"] }], "Havuz 20:00, sauna 23:00.", []],
    ];
    for (const [specs, text, items] of cases) {
      scoreNeeds(specs, text, items).forEach((n, i) => {
        if (n.wrongAnswered) expect([text, yanlisDali(specs[i], specs, text, items)]).not.toEqual([text, "bilinmiyor"]);
      });
    }
    expect(yanlisDali(null, [], "x", [])).toBe("desen_yok");
  });
});

describe("neden defteri — eşleme, ekleme, özet", () => {
  it("ihtiyaç ↔ istek: aynı tür sırayla, kalan tek çift tahmini", () => {
    expect(istekEsle(["wifi", "amenities"], ["wifi", "appliance_help"])).toEqual([{ index: 0, tahmini: false }, { index: 1, tahmini: true }]);
    expect(istekEsle(["wifi", "a", "b"], ["wifi", "c", "d"])).toEqual([{ index: 0, tahmini: false }, null, null]);
  });

  it("parça kimliği: istek sayısı = parça sayısı → sırayla; değilse ev sahibindeki tek öğe atlanır; tutmazsa güvenilmez", () => {
    expect(parcaKimlikleri(["a", "b"], [{ kind: "a", status: "pending_host" }], 2)).toEqual({ refs: ["R1", "R2"], guvenilir: true });
    expect(parcaKimlikleri(["a", "b"], [{ kind: "a", status: "pending_host" }, { kind: "b", status: "open" }], 1)).toEqual({ refs: [null, "R1"], guvenilir: true });
    expect(parcaKimlikleri(["a", "b", "c"], [], 1).guvenilir).toBe(false);
  });

  it("tekrar ekleme yutulur (defterdeki ve aynı çağrıdaki)", () => {
    const first = yeniSatirlar([], lines);
    expect(first).toEqual({ eklenecek: lines, yutulan: 0 });
    const again = yeniSatirlar(defteriAyristir(lines.map((l) => JSON.stringify(l)).join("\n")), [...lines, ...lines]);
    expect(again).toEqual({ eklenecek: [], yutulan: lines.length * 2 });
    expect(yeniSatirlar([], [lines[1], lines[1]]).yutulan).toBe(1);
  });

  it("bozuk defter satırı sessizce atlanmaz; toplu yan dosya ve tanınmayan dosya reddedilir", () => {
    expect(() => defteriAyristir('{"a":1}\n{bozuk')).toThrow(/satırı 2/);
    expect(() => girdiyiOku({ suite: "live-pipeline", rows: [{ id: "a", ok: true }] }, "x.json")).toThrow(/toplu yan dosya/);
    expect(() => girdiyiOku({ suite: "baska", rows: [] }, "x.json")).toThrow(/tanınmayan/);
  });

  it("özet: koşu satırında dört sayı, bilinmiyor oranı, deterministik", () => {
    const md = ozetMetni(lines);
    const [t] = kosuToplamlari(lines);
    expect(md).toContain(`| 2026-11-26-gpt-x-kor-deneme | dayanak-kabul | abc1234 | ${t.dogru}/${t.cevaplanmali} | ${t.tutma} (↳ ${t.metinGittiDegerYok}) | ${t.yanlis} | ${t.acikOk}/${t.acik} |`);
    expect(md).toMatch(/sebebi "bilinmiyor" 1 \(/);
    expect(md).toContain("| bilinmiyor | bilinmiyor | 1 |");
    expect(ozetMetni(lines)).toBe(md);
  });
});
