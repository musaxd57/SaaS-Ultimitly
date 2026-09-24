import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ANON, anonymizeGuestText, nameVariants } from "@/lib/eval-real/anonymize";
import { dedupeKey, guessLanguage, isStayCandidate, seededRandom, stratifiedSample } from "@/lib/eval-real/sampling";
import {
  applyLabelAction,
  buildRealDataset,
  guardedOutputPath,
  LABEL_KEYS,
  outputPathDecision,
  readOnlyVerified,
  REAL_KINDS,
  resumeIndex,
  type CandidateFile,
  type CandidateItem,
  type LabelState,
} from "@/lib/eval-real/labeling";

// ---------------------------------------------------------------------------
// GERÇEK MİSAFİR MESAJI SETİ (B) — saf çekirdek + betik pinleri (09-24). Betikler kurucunun makinesinde,
// canlı veritabanına SALT OKUMA ile bağlanır; burada ÇALIŞTIRILMAZ (CLAUDE.md: koruma saf karar fonksiyonuyla
// sınanır). Fikstürlerde gerçek ad YOK: kurgusal "Lale" / "Papatya".
// ---------------------------------------------------------------------------

const REPO = path.resolve(__dirname, "../..");
const CTX = {
  personNames: ["Ayşe Yılmaz", "Can Demir", "Mehmet Kaya"],
  placeNames: ["Lale Suites", "Papatya Evleri", "Kordon Caddesi No 5"],
};

describe("anonimleştirme — anlam kalır, kişi/yer gider", () => {
  it("kurucunun örnekleri (saat, göreli gün, bavul, hazırlık) AYNEN kalır", () => {
    for (const t of [
      "11 gibi orda olcaz sıkıntı yok dimi",
      "önceki gece boşsa erken geliriz",
      "bavulu bırakıp sonra dönsek olur mu",
      "yarın oda hazırlanmış olur mu",
      "Could we get into the flat at 11?",
      "14.10.2026 saat 13:30'da çıksak?",
      "14 - 16 Ekim arası 2 kişi, 3 gece",
      "We land at 8am, can we drop bags at 11am?",
      "Check-in 15:00-17:00 arası mı?",
    ]) {
      expect(anonymizeGuestText(t, CTX), t).toBe(t);
    }
  });

  it("bilinen adlar (tam, parça, Türkçe harfsiz yazım) ve yerler maskelenir; yaygın sözcük olan ad parçası tek başına maskelenmez", () => {
    expect(anonymizeGuestText("Merhaba, ben Ayşe. Rezervasyon Ayse Yilmaz adına.", CTX)).toBe(
      `Merhaba, ben ${ANON.person}. Rezervasyon ${ANON.person} adına.`,
    );
    expect(anonymizeGuestText("Can we check in early? - Can Demir", CTX)).toBe(`Can we check in early? - ${ANON.person}`);
    expect(anonymizeGuestText("Lale Suites'e nasıl gelirim? Lale'ye taksiyle mi?", CTX)).toBe(
      `${ANON.place}'e nasıl gelirim? ${ANON.place}'ye taksiyle mi?`,
    );
    expect(anonymizeGuestText("Kordon Caddesi No 5 doğru adres mi?", CTX)).toBe(`${ANON.place} doğru adres mi?`);
    // "Suites" yaygın sözcük: tek başına kalır (cümleyi bozmamak için).
    expect(anonymizeGuestText("Are the suites quiet?", CTX)).toBe("Are the suites quiet?");
    expect(nameVariants(["Can Demir"])).not.toContain("Can");
  });

  it("iletişim, bağlantı, IBAN, kod ve telefon biçimli diziler maskelenir", () => {
    const out = anonymizeGuestText(
      "Tel +90 532 123 45 67 / 0532.123.45.67, mail ayse.y@example.com, link https://www.airbnb.com/rooms/12345?x=1, " +
        "IBAN TR12 0006 1005 1978 6457 8413 26, kod HMABCD1234, wifi Lale2024 çalışmıyor, kapı 4832",
      CTX,
    );
    for (const leaked of ["532", "123 45", "example.com", "airbnb.com", "1978", "HMABCD1234", "Lale2024", "4832"]) {
      expect(out, leaked).not.toContain(leaked);
    }
    for (const mark of [ANON.number, ANON.email, ANON.url, ANON.iban, ANON.code]) expect(out).toContain(mark);
    expect(out).toContain(`${ANON.url}, IBAN`); // bağlantının ardındaki virgül cümleye aittir
    // Fransız biçimi telefon parça parça tarih/saat sanılmaz (tek kaynak kuralı).
    expect(anonymizeGuestText("06.12.34.56.78", CTX)).toBe(ANON.number);
  });

  it("görünmez karakterler silinir (adın arasına gizlenemez)", () => {
    expect(anonymizeGuestText("Ay​şe burada", CTX)).toBe(`${ANON.person} burada`);
  });
});

describe("örnekleme — geniş aday katmanı, tohumlu, tekrarsız", () => {
  it("aday süzgeci GENİŞ: kurucunun dolaylı örnekleri ve saat/tarih/zaman sözcükleri girer; saf bilgi/teşekkür girmez", () => {
    for (const t of [
      "11 gibi orda olcaz sıkıntı yok dimi",
      "önceki gece boşsa erken geliriz",
      "bavulu bırakıp sonra dönsek",
      "yarın oda hazırlanmış olur mu",
      "Could we get into the flat at 11?",
      "Is the place free on the 14th?",
      "Können wir früher kommen?",
      "Можно заехать пораньше?",
    ]) {
      expect(isStayCandidate(t), t).toBe(true);
    }
    for (const t of ["Wifi şifresi ne?", "Teşekkürler, her şey harikaydı", "Where is the hair dryer?"]) {
      expect(isStayCandidate(t), t).toBe(false);
    }
  });

  it("🚨 aday süzgeci ürünün dedektöründen BAĞIMSIZ (ölçülecek şey ölçüm setine gömülmez)", () => {
    const src = readFileSync(path.join(REPO, "src/lib/eval-real/sampling.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*availability-claims["']/);
    expect(src).not.toMatch(/from\s+["'][^"']*semantic\//);
  });

  it("tohum → aynı örnek; farklı tohum → farklı; tekrarlar tek; kotalar ve evren boyutları doğru", () => {
    const items = [
      ...Array.from({ length: 40 }, (_, i) => `Saat ${i % 24}:00 gibi gelsek olur mu ${i}`),
      ...Array.from({ length: 40 }, (_, i) => `Havlu nerede acaba ${i}`),
      "Thank you!",
      "thank you",
      "Thank you!!",
    ];
    const opts = { text: (t: string) => t, candidateQuota: 10, restQuota: 5, seed: "tohum-1" };
    const a = stratifiedSample(items, opts);
    const b = stratifiedSample(items, opts);
    expect(a).toEqual(b);
    expect(stratifiedSample(items, { ...opts, seed: "tohum-2" }).picked).not.toEqual(a.picked);
    expect(a.population).toEqual({ candidate: 40, rest: 41 }); // üç "thank you" → bir
    expect(a.picked.filter((p) => p.stratum === "candidate")).toHaveLength(10);
    expect(a.picked.filter((p) => p.stratum === "rest")).toHaveLength(5);
    for (const p of a.picked) expect(isStayCandidate(p.item)).toBe(p.stratum === "candidate");
    expect(new Set(a.picked.map((p) => dedupeKey(p.item))).size).toBe(a.picked.length);
  });

  it("tohumlu sayı üreteci [0,1) aralığında ve tekrarlanabilir", () => {
    const r1 = seededRandom("x");
    const r2 = seededRandom("x");
    const xs = Array.from({ length: 100 }, () => r1());
    expect(xs).toEqual(Array.from({ length: 100 }, () => r2()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it("kaba dil tahmini (yalnız rapor kırılımı)", () => {
    expect(guessLanguage("Yarın erken gelebilir miyiz?")).toBe("tr");
    expect(guessLanguage("Can we check in early?")).toBe("en");
    expect(guessLanguage("Können wir bitte früher kommen?")).toBe("de");
    expect(guessLanguage("Можно заехать пораньше?")).toBe("ru");
    expect(guessLanguage("هل يمكننا الوصول مبكرا؟")).toBe("ar");
  });
});

const ITEMS: CandidateItem[] = [
  { id: "r-0001", stratum: "candidate", text: "11 gibi orda olcaz", lang: "tr", checkIn: "15:00", checkOut: "11:00" },
  { id: "r-0002", stratum: "rest", text: "Wifi?", lang: "en", checkIn: "15:00", checkOut: "11:00" },
  { id: "r-0003", stratum: "candidate", text: "[AD] burada, 12'de çıksak", lang: "tr", checkIn: "15:00", checkOut: "11:00" },
  { id: "r-0004", stratum: "candidate", text: "belirsiz", lang: "tr", checkIn: "15:00", checkOut: "11:00" },
];

describe("kör etiketleme — saf durum geçişi ve set üretimi", () => {
  it("tuş etiketler ve ilerler; bilinmeyen tuş durumu DEĞİŞTİRMEZ; geri bir adım; sınırlar", () => {
    let s: LabelState = { labels: {}, index: 0 };
    s = applyLabelAction(s, ITEMS, { type: "key", key: "2" });
    expect(s).toEqual({ labels: { "r-0001": "early" }, index: 1 });
    const same = applyLabelAction(s, ITEMS, { type: "key", key: "9" });
    expect(same).toBe(s);
    s = applyLabelAction(s, ITEMS, { type: "back" });
    expect(s.index).toBe(0);
    expect(applyLabelAction({ labels: {}, index: 0 }, ITEMS, { type: "back" }).index).toBe(0);
    const end = { labels: {}, index: ITEMS.length };
    expect(applyLabelAction(end, ITEMS, { type: "key", key: "0" })).toBe(end);
  });

  it("tuş kümesi eval şemasının kapalı kümesiyle AYNI (+ yalnız iki çıkış)", () => {
    const kinds = Object.values(LABEL_KEYS).filter((l) => l !== "pii" && l !== "unsure");
    expect([...kinds].sort()).toEqual([...REAL_KINDS].sort());
    const evalKinds = new Set(
      (JSON.parse(readFileSync(path.join(REPO, "evals/stay-change.json"), "utf8")) as { requests: { kind: string }[] }).requests.map((r) => r.kind),
    );
    expect([...evalKinds].sort()).toEqual([...REAL_KINDS].sort());
  });

  it("kaldığı yerden devam: ilk etiketsiz öğe", () => {
    expect(resumeIndex(ITEMS, {})).toBe(0);
    expect(resumeIndex(ITEMS, { "r-0001": "none", "r-0002": "none" })).toBe(2);
    expect(resumeIndex(ITEMS, { "r-0001": "none", "r-0002": "none", "r-0003": "late", "r-0004": "unsure" })).toBe(4);
  });

  it("🚨 set yalnız geçerli etiketli öğeleri taşır; kişisel bilgi / emin değilim / etiketsiz DIŞARIDA (yalnız sayı)", () => {
    const file: CandidateFile = { kind: "lixus-real-candidates", version: 1, seed: "s", population: { candidate: 50, rest: 70 }, items: ITEMS };
    const ds = buildRealDataset(file, { "r-0001": "early", "r-0002": "none", "r-0003": "pii" });
    expect(ds.requests.map((r) => [r.id, r.kind, r.split])).toEqual([
      ["r-0001", "early", "real"],
      ["r-0002", "none", "real"],
    ]);
    expect(ds.excluded).toEqual({ pii: 1, unsure: 0, unlabeled: 1 });
    expect(ds.strata).toEqual({ candidate: { population: 50, labeled: 1 }, rest: { population: 70, labeled: 1 } });
    expect(JSON.stringify(ds)).not.toContain("12'de çıksak"); // kişisel bilgi işaretli öğenin metni sete girmez
    expect(JSON.stringify(ds)).not.toContain("stratum"); // katman etiketi sete sızmaz (kör)
  });
});

describe("kapılar — salt okuma ve çıktı yolu", () => {
  it("salt-okuma yalnız TAM 'on' ile doğrulanır", () => {
    expect(readOnlyVerified([{ transaction_read_only: "on" }])).toBe(true);
    for (const bad of [[{ transaction_read_only: "off" }], [], null, undefined, [{}], [{ transaction_read_only: "on" }, { transaction_read_only: "on" }], "on", [{ transaction_read_only: true }]]) {
      expect(readOnlyVerified(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it("🚨 depo içinde yalnız git'in yok saydığı evals/private/ altına yazılır; depo dışı serbest", () => {
    expect(outputPathDecision({ relToRepo: "evals/private/x.json", insideRepo: true, gitIgnored: true })).toEqual({ ok: true });
    expect(outputPathDecision({ relToRepo: "evals/private/x.json", insideRepo: true, gitIgnored: false }).ok).toBe(false);
    expect(outputPathDecision({ relToRepo: "evals/x.json", insideRepo: true, gitIgnored: true }).ok).toBe(false);
    expect(outputPathDecision({ relToRepo: "evals\\private\\x.json", insideRepo: true, gitIgnored: true })).toEqual({ ok: true });
    expect(outputPathDecision({ relToRepo: "../Desktop/x.json", insideRepo: false, gitIgnored: false })).toEqual({ ok: true });
    const repo = "/r/repo";
    expect(() => guardedOutputPath(repo, "evals/private/a.json", () => false)).toThrow(/yok sayılmıyor/);
    expect(() => guardedOutputPath(repo, "src/a.json", () => true)).toThrow(/evals\/private/);
    expect(guardedOutputPath(repo, "evals/private/a.json", () => true)).toBe("/r/repo/evals/private/a.json");
    let asked = false;
    expect(guardedOutputPath(repo, "/tmp/out.json", () => (asked = true))).toBe("/tmp/out.json");
    expect(asked).toBe(false); // depo dışı yol için git'e sorulmaz
  });
});

describe("betik pinleri (çalıştırılmadan, kaynak üzerinden)", () => {
  const exportSrc = readFileSync(path.join(REPO, "scripts/eval-real-export.ts"), "utf8");
  const labelSrc = readFileSync(path.join(REPO, "scripts/eval-real-label.ts"), "utf8");

  it("🚨 dışa aktarım: işlemin İLK komutu SET TRANSACTION READ ONLY, doğrulama veri sorgularından ÖNCE", () => {
    const setRo = exportSrc.indexOf('$executeRawUnsafe("SET TRANSACTION READ ONLY")');
    const verify = exportSrc.indexOf("readOnlyVerified(await tx.$queryRawUnsafe(\"SHOW transaction_read_only\"))");
    const firstData = exportSrc.indexOf("tx.$queryRaw<");
    expect(setRo).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(setRo);
    expect(firstData).toBeGreaterThan(verify);
    // İşlem gövdesinin ilk satırı READ ONLY (araya başka komut giremez).
    const body = exportSrc.slice(exportSrc.indexOf("async (tx) => {"));
    expect(body.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"))[1]).toBe(
      'await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");',
    );
  });

  it("🚨 dışa aktarım yalnız OKUR: yazma API'si / yazma SQL'i yok; ham komutlar yalnız SET", () => {
    // Prisma MODEL erişimi hiç yok (yalnız `$queryRaw` / `$executeRawUnsafe("SET …")` / `$transaction` / `$disconnect`):
    // `prisma.user.update(` gibi bir yazma yolu yazılamaz. (Kripto özetinin `.update(` çağrısı model erişimi değildir.)
    expect(exportSrc).not.toMatch(/\b(?:prisma|tx)\.(?!\$)[A-Za-z_]/);
    expect(exportSrc).toMatch(/\btx\.\$queryRaw</); // anti-vakum: kalıp gerçekten tx erişimlerini görüyor
    expect(exportSrc).not.toMatch(/\$executeRaw`/);
    expect(exportSrc).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|GRANT|COPY)\b/);
    const unsafe = [...exportSrc.matchAll(/\$executeRawUnsafe\("([^"]*)"\)/g)].map((m) => m[1]);
    expect(unsafe.length).toBeGreaterThan(0);
    for (const cmd of unsafe) expect(cmd.startsWith("SET "), cmd).toBe(true);
  });

  it("dışa aktarım mesaj METNİNİ ekrana basmaz; veritabanı adresi gizli sorulur", () => {
    const logs = exportSrc.split("\n").filter((l) => /console\.(?:log|error)\(/.test(l));
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l, l).not.toMatch(/\.body|\.text\b|\burl\b/);
    expect(exportSrc).toContain("askHidden(");
  });

  it("etiketleme veritabanına bağlanmaz ve öğenin katmanını GÖSTERMEZ (kör)", () => {
    expect(labelSrc).not.toContain("@prisma/client");
    expect(labelSrc).not.toContain(".stratum");
  });
});
