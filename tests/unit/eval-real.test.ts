import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ANON, anonymizeGuestText, nameVariants } from "@/lib/eval-real/anonymize";
import { dedupeKey, guessLanguage, isStayCandidate, seededRandom, stratifiedSample } from "@/lib/eval-real/sampling";
import {
  applyLabelAction,
  bindLabelFile,
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
  nowYear: 2026,
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
    expect(nameVariants(["Can Demir"]).anywhere).not.toContain("Can");
    expect(nameVariants(["Can Demir"]).namePosition).toContain("Can");
  });

  it("🚨 inceleme 09-24: saat ve süre biçimleri KOD sayılmaz (FR/DE/EN/TR zaman istekleri korunur)", () => {
    for (const t of ["arriver à 13h30 au lieu de 16h00", "um 11Uhr", "extend 2nights", "1gece daha kalabilir miyiz", "We land 8am", "3pax"]) {
      expect(anonymizeGuestText(t, CTX), t).toBe(t);
    }
  });

  it("🚨 inceleme 09-24: Türkçe büyük harf (İ/ı), kesmesiz ek ve yaygın-sözcük adlar AD KONUMUNDA yakalanır; cümle bozulmaz", () => {
    const ctx = { personNames: ["Fatih Işık", "Ali Kaya", "Can"], placeNames: [], nowYear: 2026 };
    expect(anonymizeGuestText("FATİH IŞIK burada", ctx)).toBe(`${ANON.person} burada`);
    expect(anonymizeGuestText("Fatihle konuştum", ctx)).toBe(`${ANON.person} konuştum`);
    expect(anonymizeGuestText("Ben Ali, Kaya ailesi olarak geliyoruz", ctx)).toBe(`Ben ${ANON.person}, ${ANON.person} ailesi olarak geliyoruz`);
    expect(anonymizeGuestText("Hi, Can here", ctx)).toBe(`Hi, ${ANON.person} here`);
    // Aşırı-uygulama kontrolü: cümle başındaki ve küçük harfli yaygın sözcük bozulmaz.
    for (const t of ["Can we check in at 11?", "Yes we can stay", "Kaya ailesi olarak geliyoruz"]) expect(anonymizeGuestText(t, ctx), t).toBe(t);
  });

  it("🚨 inceleme 09-24: sistemin yer tutucu adları ('Misafir', 'Rezervasyon <kod>') ad sayılmaz; kod ayrıca maskelenir", () => {
    const ctx = { personNames: ["Misafir", "Eski misafir", "Rezervasyon QWERTY"], placeNames: [], nowYear: 2026 };
    expect(anonymizeGuestText("Misafir olarak soruyorum, rezervasyon tarihini değiştirebilir miyiz?", ctx)).toBe(
      "Misafir olarak soruyorum, rezervasyon tarihini değiştirebilir miyiz?",
    );
    expect(anonymizeGuestText("Rezervasyon QWERTY için", ctx)).toBe(`Rezervasyon ${ANON.code} için`);
  });

  it("🚨 inceleme 09-24: yer adında yalnız tam ad + ilk ayırt edici parça ('Lale Stay' → 'Stay' tek başına kalır)", () => {
    const ctx = { personNames: [], placeNames: ["Lale Stay"], nowYear: 2026 };
    expect(anonymizeGuestText("Can we stay one more night?", ctx)).toBe("Can we stay one more night?");
    expect(anonymizeGuestText("Lale Stay'e nasıl gelirim, Lale'ye taksi?", ctx)).toBe(`${ANON.place}'e nasıl gelirim, ${ANON.place}'ye taksi?`);
  });

  it("🚨 inceleme 09-24: plaka, boşluklu kod, Arap-Hint / tam genişlik rakamlı telefon, doğum tarihi maskelenir; yakın tarih ve aralık kalır", () => {
    expect(anonymizeGuestText("Plakamız 34 ABC 123", CTX)).toBe(`Plakamız ${ANON.code}`);
    expect(anonymizeGuestText("kapı kodu 4 8 2 6", CTX)).toBe(`kapı kodu ${ANON.number}`);
    expect(anonymizeGuestText("tel ٠٥٣٢١٢٣٤٥٦٧", CTX)).toBe(`tel ${ANON.number}`);
    expect(anonymizeGuestText("tel ０５３２１２３４５６７", CTX)).toBe(`tel ${ANON.number}`);
    expect(anonymizeGuestText("doğum tarihim 12.03.1985", CTX)).toBe(`doğum tarihim ${ANON.date}`);
    expect(anonymizeGuestText("12.03.85 doğumluyum", CTX)).toBe(`${ANON.date} doğumluyum`);
    for (const t of ["14.10.2026'da geliyoruz", "14.10.26 tarihinde", "14 - 16 Ekim", "12-14 arası"]) expect(anonymizeGuestText(t, CTX), t).toBe(t);
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

  it("🚨 mutasyon turu 09-24 (ER6 hayatta kalmıştı): 5–8 karakterlik harf+rakam kodu da maskelenir (kapı kodu, Wi-Fi şifresi)", () => {
    for (const code of ["A7F3K", "Rx82mQ7", "kP4z9Wq2"]) {
      const out = anonymizeGuestText(`kapı kodu ${code} çalışmıyor`, CTX);
      expect(out, code).toBe(`kapı kodu ${ANON.code} çalışmıyor`);
    }
    // Aşırı-uygulama kontrolü: 4 karakterlik karışık belirteç ("B12a") kod sayılmaz.
    expect(anonymizeGuestText("daire B12a", CTX)).toBe("daire B12a");
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

  it("🚨 mutasyon turu 09-24 (ER15 hayatta kalmıştı): sonuç sırası katmana göre GRUPLU değil — etiketleyen sıradan katmanı tahmin edemez", () => {
    const items = [
      ...Array.from({ length: 30 }, (_, i) => `Saat ${i % 24}:00 gibi gelsek olur mu ${i}`),
      ...Array.from({ length: 30 }, (_, i) => `Havlu nerede acaba ${i}`),
    ];
    const order = stratifiedSample(items, { text: (t: string) => t, candidateQuota: 10, restQuota: 10, seed: "tohum-1" }).picked.map((p) => p.stratum);
    const grouped = [...Array(10).fill("candidate"), ...Array(10).fill("rest")];
    expect(order).toHaveLength(20);
    expect(order).not.toEqual(grouped);
    // İlk yarıda en az bir "rest" ve son yarıda en az bir "candidate" (tohumla sabit; karışım gerçekten var).
    expect(order.slice(0, 10)).toContain("rest");
    expect(order.slice(10)).toContain("candidate");
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
    const bound = bindLabelFile({ kind: "lixus-real-labels", candidatesSha256: "abc", labels: { "r-0001": "early", "r-0002": "none", "r-0003": "pii" } }, "abc");
    const ds = buildRealDataset(file, bound);
    expect(ds.requests.map((r) => [r.id, r.kind, r.split, r.stratum])).toEqual([
      ["r-0001", "early", "real", "candidate"],
      ["r-0002", "none", "real", "rest"],
    ]);
    expect(ds.candidatesSha256).toBe("abc");
    expect(ds.excluded).toEqual({ pii: 1, unsure: 0, unlabeled: 1 });
    expect(ds.strata).toEqual({ candidate: { population: 50, labeled: 1 }, rest: { population: 70, labeled: 1 } });
    expect(JSON.stringify(ds)).not.toContain("12'de çıksak"); // kişisel bilgi işaretli öğenin metni sete girmez
  });

  it("🚨 inceleme 09-24 (P1): etiketler YALNIZ ait oldukları aday dosyasıyla kullanılır — yeniden üretilmiş dosyaya sessizce oturmaz", () => {
    expect(bindLabelFile(null, "sha-1")).toEqual({ kind: "lixus-real-labels", candidatesSha256: "sha-1", labels: {} });
    const lf = { kind: "lixus-real-labels", candidatesSha256: "sha-1", labels: { "r-0001": "early" } };
    expect(bindLabelFile(lf, "sha-1").labels).toEqual({ "r-0001": "early" });
    expect(() => bindLabelFile(lf, "sha-2")).toThrow(/BAŞKA bir aday dosyasına/);
    expect(() => bindLabelFile({ "r-0001": "early" }, "sha-1")).toThrow(/tanınmadı/); // eski düz biçim: bağ yok → ret
    expect(() => bindLabelFile({ ...lf, labels: { "r-0001": "maybe" } }, "sha-1")).toThrow(/tanınmayan/);
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

  it("🚨 dışa aktarım: her okuma `readOnly` içinde; ilk komut READ ONLY, doğrulama TÜM SET'lerden SONRA, veri sorgusundan ÖNCE", () => {
    const helper = exportSrc.slice(exportSrc.indexOf("async function readOnly<T>"), exportSrc.indexOf("interface MsgRow"));
    const lines = helper.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//") && !l.startsWith("*"));
    const first = lines.findIndex((l) => l.startsWith("await tx.$executeRawUnsafe("));
    expect(lines[first]).toBe('await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");');
    expect(lines[first + 1]).toBe(`await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '60s'");`);
    expect(lines[first + 2]).toBe('if (!readOnlyVerified(await tx.$queryRawUnsafe("SHOW transaction_read_only"))) {');
    expect(helper.indexOf("return fn(tx);")).toBeGreaterThan(helper.indexOf("readOnlyVerified("));
    // Veri sorguları YALNIZ `readOnly(prisma, …)` geri çağrılarında (doğrudan `prisma.$transaction` başka yerde yok).
    expect(exportSrc.split("prisma.$transaction(").length - 1).toBe(1);
    expect(exportSrc.split("await readOnly(prisma,").length - 1).toBe(2);
  });

  it("🚨 dışa aktarım yalnız OKUR: model erişimi yok, ham komutlar TAM OLARAK izinli liste, SQL gövdelerinde yazma sözcüğü yok (harf duyarsız)", () => {
    // Prisma MODEL erişimi hiç yok: `prisma.user.update(` gibi bir yazma yolu yazılamaz. (Kripto özetinin `.update(`
    // çağrısı model erişimi değildir.)
    expect(exportSrc).not.toMatch(/\b(?:prisma|tx)\.(?!\$)[A-Za-z_]/);
    expect(exportSrc).toMatch(/\btx\.\$queryRaw</); // anti-vakum: kalıp gerçekten tx erişimlerini görüyor
    expect(exportSrc).not.toMatch(/\$executeRaw`/);
    expect(exportSrc).not.toMatch(/\bprisma\.\$(?:queryRaw|executeRaw)/);
    const unsafeExec = [...exportSrc.matchAll(/\$executeRawUnsafe\(([^)]*)\)/g)].map((m) => m[1]);
    expect(unsafeExec).toEqual(['"SET TRANSACTION READ ONLY"', `"SET LOCAL statement_timeout = '60s'"`]);
    const unsafeQuery = [...exportSrc.matchAll(/\$queryRawUnsafe\(([^)]*)\)/g)].map((m) => m[1]);
    expect(unsafeQuery).toEqual(['"SHOW transaction_read_only"']);
    const sqlBodies = [...exportSrc.matchAll(/\$queryRaw<[^`]*`([^`]*)`/g)].map((m) => m[1]);
    expect(sqlBodies.length).toBeGreaterThanOrEqual(6); // anti-vakum
    for (const sql of sqlBodies) {
      expect(sql, sql).toMatch(/^\s*SELECT\b/i);
      expect(sql, sql).not.toMatch(/\b(?:insert|update|delete|truncate|alter|drop|grant|revoke|copy|create|merge|call|lock|vacuum|refresh|reindex|cluster|comment|set|reset|do)\b/i);
    }
  });

  it("🚨 inceleme 09-24: yalnız SAHİBİN kendi kuruluşu + açık 'EVET' onayı; --org yok; aday dosyasının üzerine yazmaz; sıralama tekrarlanabilir", () => {
    expect(exportSrc).not.toContain('"--org"');
    expect(exportSrc).toContain('if (users[0].role !== "owner")');
    expect(exportSrc).toContain('if (answer !== "EVET")');
    expect(exportSrc.indexOf('if (answer !== "EVET")')).toBeLessThan(exportSrc.indexOf('FROM "Message" m\n        JOIN'));
    expect(exportSrc).toContain('if (existsSync(out) && !process.argv.includes("--force"))');
    expect(exportSrc).toContain('ORDER BY m."createdAt" DESC, m.id DESC');
  });

  it("dışa aktarım mesaj METNİNİ ekrana basmaz; veritabanı adresi gizli sorulur; veritabanı hatası yalnız KOD olarak basılır", () => {
    const logs = exportSrc.split("\n").filter((l) => /console\.(?:log|error)\(/.test(l));
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l, l).not.toMatch(/\.body|\.text\b|\burl\b/);
    expect(exportSrc).toMatch(/ask\("Veritabanı adresi[^"]*", true\)/);
    expect(exportSrc).toContain('!String(e?.name ?? "").startsWith("PrismaClient")');
    expect(exportSrc).toContain("typeof e?.errorCode === \"string\"");
  });

  it("etiketleme veritabanına bağlanmaz, öğenin katmanını GÖSTERMEZ (kör) ve etiketleri aday dosyasının SHA'sına bağlar", () => {
    expect(labelSrc).not.toContain("@prisma/client");
    expect(labelSrc).not.toContain(".stratum");
    expect(labelSrc).toContain("bindLabelFile(");
    expect(labelSrc).toContain('createHash("sha256").update(candidatesBytes)');
  });

  it("🚨 yanlışlıkla commit pini: takip edilen hiçbir JSON dosyası gerçek aday / etiket / set verisi taşımaz", () => {
    let tracked: string[] = [];
    try {
      tracked = execFileSync("git", ["-c", `safe.directory=${REPO}`, "ls-files", "-z", "*.json"], { cwd: REPO, encoding: "utf8" })
        .split("\0")
        .filter(Boolean);
    } catch {
      tracked = [];
    }
    expect(tracked.length).toBeGreaterThan(5); // anti-vakum: git gerçekten JSON dosyası görüyor
    const offenders = tracked.filter((f) => {
      const t = readFileSync(path.join(REPO, f), "utf8");
      return /"kind"\s*:\s*"lixus-real-(?:candidates|labels)"|"source"\s*:\s*"real-anonymized"/.test(t);
    });
    expect(offenders).toEqual([]);
  });
});

describe("geçmiş mesaj taraması betiği (09-24) — yalnız okur, yalnız sayı yazar", () => {
  const statsSrc = readFileSync(path.join(REPO, "scripts/eval-real-stats.ts"), "utf8");

  it("🚨 ham komut YOK (dışa aktarımın pinli `readOnly` yardımcısı), model erişimi yok, her SQL gövdesi SELECT", () => {
    expect(statsSrc).toContain('import { ask, readOnly } from "./eval-real-export";');
    expect(statsSrc).not.toMatch(/\$(?:executeRaw|queryRawUnsafe|executeRawUnsafe)/);
    expect(statsSrc).not.toMatch(/\bprisma\.\$(?:queryRaw|transaction)/);
    expect(statsSrc).not.toMatch(/\b(?:prisma|tx)\.(?!\$)[A-Za-z_]/);
    expect(statsSrc.split("await readOnly(prisma,").length - 1).toBe(2);
    const sqlBodies = [...statsSrc.matchAll(/\$queryRaw<[^`]*`([^`]*)`/g)].map((m) => m[1]);
    expect(sqlBodies.length).toBeGreaterThanOrEqual(6); // anti-vakum
    for (const sql of sqlBodies) {
      expect(sql, sql).toMatch(/^\s*SELECT\b/i);
      expect(sql, sql).not.toMatch(/\b(?:insert|update|delete|truncate|alter|drop|grant|revoke|copy|create|merge|call|lock|vacuum|refresh|reindex|cluster|comment|set|reset|do)\b/i);
    }
    // Kiracı kapsamı: mülk / rezervasyon / görev / mesaj okuyan HER sorgu yalnız sahibin kuruluşuna bağlı.
    const scoped = sqlBodies.filter((sql) => /FROM "(?:Property|Reservation|Task|Message)"/.test(sql));
    expect(scoped.length).toBe(4);
    for (const sql of scoped) expect(sql, sql).toMatch(/"organizationId" = \$\{org\.id\}/);
    // Yalnız misafirin yazdığı gelen mesajlar (bizim cevaplarımız, ev sahibi ve sistem satırları sayılmaz).
    expect(statsSrc).toContain(`AND m.direction = 'inbound'`);
    expect(statsSrc).toContain(`AND (m."authorType" IS NULL OR m."authorType" = 'guest')`);
  });

  it("🚨 yalnız SAHİBİN kendi kuruluşu + mesajlar okunmadan ÖNCE 'EVET'; ekrana metin basılmaz; çıktı git'in yok saydığı yola", () => {
    expect(statsSrc).toContain('if (users[0].role !== "owner")');
    expect(statsSrc.indexOf('if (answer !== "EVET")')).toBeGreaterThan(-1);
    expect(statsSrc.indexOf('if (answer !== "EVET")')).toBeLessThan(statsSrc.indexOf('FROM "Message" m'));
    const logs = statsSrc.split("\n").filter((l) => /console\.(?:log|error)\(/.test(l));
    expect(logs.length).toBeGreaterThan(0);
    for (const l of logs) expect(l, l).not.toMatch(/\.body|\.text\b|\burl\b/);
    expect(statsSrc).toContain("guardedOutputPath(REPO,");
    expect(statsSrc).toMatch(/ask\("Veritabanı adresi[^"]*", true\)/);
  });
});
