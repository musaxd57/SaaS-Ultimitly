import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildDemoDataset, type DemoDataset } from "@/lib/demo-tenant/dataset";
import { decideDemoRun } from "@/lib/demo-tenant/cli";
import { DEMO_STORAGE_PHOTO_URL_PREFIX } from "@/lib/demo-tenant/apply-core";
import { DEMO_LOGIN_EMAIL, DEMO_MAX_CANCELLED_PER_PROPERTY, DEMO_ORG_ID } from "@/lib/demo-tenant/constants";
import { STORAGE_PHOTO_URL_PREFIX } from "@/lib/storage/keys";
import { classifyFallback, foldTurkishLower } from "@/lib/ai/fallback";
import { vetoOutgoingReply } from "@/lib/ai/output-veto";
import { admitsMissingKnowledge } from "@/lib/ai/absence";
import { kbPlaceholderTokens } from "@/lib/kb-placeholders";
import { addNights, describeNights, type ReservationSnapshot } from "@/modules/availability/core";

// ---------------------------------------------------------------------------
// DEMO HESABI — veri kümesi sözleşmesi (saf; DB yok). Airbnb inceleme ekibi bu veriyi görecek:
// sentetik olduğu kimliğinden okunur, gerçek kişi/iletişim/sır taşımaz, ürünün KENDİ güvenlik
// kapılarından geçer, çift rezervasyon üretmez, şikâyet asla "yeni" durumda (otomatik uyarı e-postası)
// doğmaz ve aynı saat için birebir aynıdır.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-01T09:30:00Z");
const DAY = 86_400_000;
const ds = buildDemoDataset({ now: NOW });

function allIds(d: DemoDataset): string[] {
  return [
    d.org.id,
    ...d.users.map((x) => x.id),
    ...d.properties.map((x) => x.id),
    ...d.reservations.map((x) => x.id),
    ...d.conversations.map((x) => x.id),
    ...d.messages.map((x) => x.id),
    ...d.tasks.map((x) => x.id),
    ...d.kbItems.map((x) => x.id),
    ...d.templates.map((x) => x.id),
  ];
}

describe("determinizm", () => {
  it("aynı saat → birebir aynı veri kümesi", () => {
    expect(buildDemoDataset({ now: NOW })).toEqual(ds);
  });

  it("saat üç gün ilerleyince her tarih tam üç gün kayar; kimlik ve metin aynı kalır", () => {
    const later = buildDemoDataset({ now: new Date(NOW.getTime() + 3 * DAY) });
    expect(allIds(later)).toEqual(allIds(ds));
    const shift = (a: Date, b: Date) => b.getTime() - a.getTime();
    later.reservations.forEach((r, i) => {
      expect(shift(ds.reservations[i].arrivalDate, r.arrivalDate)).toBe(3 * DAY);
      expect(shift(ds.reservations[i].departureDate, r.departureDate)).toBe(3 * DAY);
    });
    later.messages.forEach((m, i) => {
      expect(shift(ds.messages[i].createdAt, m.createdAt)).toBe(3 * DAY);
      expect(m.body).toBe(ds.messages[i].body);
    });
    later.tasks.forEach((t, i) => expect(shift(ds.tasks[i].dueAt, t.dueAt)).toBe(3 * DAY));
  });
});

describe("kimlik ve gizlilik", () => {
  it("her kimlik `lxdemo-` ile başlar, depolama anahtarı kuralına uyar ve eşsizdir", () => {
    const ids = allIds(ds);
    for (const id of ids) {
      expect(id).toMatch(/^lxdemo-[a-z0-9-]+$/);
      expect(id.length).toBeLessThanOrEqual(64);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("misafir iletişimi yok; e-postalar yalnız giriş adresi ve example.com", () => {
    for (const r of ds.reservations) {
      expect(r).not.toHaveProperty("guestEmail");
      expect(r).not.toHaveProperty("guestPhone");
      expect(r.guestName).toMatch(/^\p{Lu}\p{Ll}+ \p{Lu}\.$/u); // "Ad S." — gerçek kişi değil
    }
    for (const u of ds.users) expect(u.email === DEMO_LOGIN_EMAIL || u.email.endsWith("@example.com")).toBe(true);
  });

  it("sır YOK: bilgi tabanı, mesaj ve şablonlarda 4+ haneli sayı (kod/şifre biçimi) geçmez", () => {
    const texts = [...ds.kbItems.map((k) => k.content), ...ds.messages.map((m) => m.body), ...ds.templates.map((t) => t.body)];
    for (const t of texts) expect(t, t).not.toMatch(/\d{4,}/);
  });

  it("kurucunun gerçek işletme adı veri kümesinde geçmez (iğne karakter kodlarından)", () => {
    const hay = foldTurkishLower(JSON.stringify(ds));
    for (const n of [String.fromCharCode(110, 117, 118, 101), String.fromCharCode(110, 252, 118, 101)]) {
      expect(hay.includes(foldTurkishLower(n))).toBe(false);
    }
    // Anti-vakumluk: tarama gerçekten metni görüyor.
    expect(hay).toContain("lale");
  });

  it("sahte bağlantı YOK: rezervasyon kodu ve sağlayıcı konuşma kimliği yazılmaz", () => {
    for (const r of ds.reservations) expect(r).not.toHaveProperty("sourceReference");
    for (const c of ds.conversations) expect(c).not.toHaveProperty("externalReservationId");
  });
});

describe("ürünün kendi kapıları", () => {
  it("🚨 'yeni' durumdaki konuşmanın misafir mesajı şikâyet/iade DEĞİLDİR (otomatik uyarı e-postası tetiklenmez)", () => {
    const fresh = new Set(ds.conversations.filter((c) => c.status === "new").map((c) => c.id));
    expect(fresh.size).toBeGreaterThanOrEqual(2);
    for (const m of ds.messages.filter((x) => fresh.has(x.conversationId) && x.direction === "inbound")) {
      expect(["complaint", "refund"], m.body).not.toContain(classifyFallback(m.body).intent);
    }
  });

  it("sorunlu konuşmanın ilk misafir mesajı ürünün sınıflandırıcısıyla gerçekten şikâyet/iade", () => {
    const problem = ds.conversations.filter((c) => c.status === "problem");
    expect(problem.length).toBeGreaterThanOrEqual(2);
    for (const c of problem) {
      const first = ds.messages.find((m) => m.conversationId === c.id && m.direction === "inbound")!;
      expect(["complaint", "refund"], first.body).toContain(classifyFallback(first.body).intent);
    }
  });

  it("AI satırları çıktı vetosundan ve 'bilgim yok' kapısından geçer; sihirli gönderici adıyla yazılır", () => {
    const ai = ds.messages.filter((m) => m.authorType === "ai");
    expect(ai.length).toBeGreaterThanOrEqual(6);
    for (const m of ai) {
      expect(vetoOutgoingReply(m.body), m.body).toBeNull();
      expect(admitsMissingKnowledge(m.body), m.body).toBe(false);
      expect(m.senderName).toBe("GuestOps AI");
      expect(m.aiAssisted).toBe(true);
    }
  });

  it("cevaplanmış konuşma BİZİM mesajımızla, yeni konuşma misafirin mesajıyla biter", () => {
    for (const c of ds.conversations) {
      const msgs = ds.messages.filter((m) => m.conversationId === c.id).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const last = msgs.at(-1)!;
      if (c.status === "new") expect(last.direction).toBe("inbound");
      else expect(last.direction).toBe("outbound");
      expect(c.lastMessageAt).toEqual(last.createdAt);
    }
  });

  it("bilgi tabanında doldurulmamış yer tutucu ya da şablon işaretçisi yok; şablonlarda yalnız çözülen {{guestName}}", () => {
    for (const k of ds.kbItems) {
      expect(kbPlaceholderTokens(k.content), k.content).toEqual([]);
      expect(k.content).not.toContain("{{");
    }
    for (const t of ds.templates) expect(t.body.replace(/\{\{guestName\}\}/g, "")).not.toMatch(/\{\{|\[|<|___/);
  });
});

describe("takvim gerçekçiliği", () => {
  const today = ds.todayKey;
  const key = (d: Date) => d.toISOString().slice(0, 10);
  const live = ds.reservations.filter((r) => r.status !== "cancelled");

  it("🚨 hiçbir mülkte çift rezervasyon YOK (müsaitlik motoruyla ölçüldü)", () => {
    for (const p of ds.properties) {
      const reservations: ReservationSnapshot[] = ds.reservations
        .filter((r) => r.propertyId === p.id)
        .map((r) => ({ id: r.id, arrival: r.arrivalDate, departure: r.departureDate, status: r.status, origin: "host_entered", calendarSourceId: null, feedLastSeenAt: null }));
      // Tüm pencere (−120 … +80 gün), motorun gece tavanına uygun 50 gecelik dilimlerle.
      for (let from = -125; from < 85; from += 50) {
        const r = describeNights(
          { propertyId: p.id, timeZone: ds.org.timezone, now: NOW, reservations, sources: [], loadTruncated: false },
          { from: addNights(ds.todayKey, from), to: addNights(ds.todayKey, from + 50) },
        );
        expect(r.ok, p.name).toBe(true);
        expect(r.ok && r.value.conflicts, `${p.name} ${from}`).toEqual([]);
      }
    }
  });

  it("bugünün sahneleri: en az üç giriş, üç çıkış ve bir aynı gün devir", () => {
    const arrivals = live.filter((r) => key(r.arrivalDate) === today);
    const departures = live.filter((r) => key(r.departureDate) === today);
    expect(arrivals.length).toBeGreaterThanOrEqual(3);
    expect(departures.length).toBeGreaterThanOrEqual(3);
    const turnover = arrivals.filter((a) => departures.some((d) => d.propertyId === a.propertyId));
    expect(turnover.length).toBeGreaterThanOrEqual(1);
  });

  it("önümüzdeki 30 gece doluluk en az %60; iptal mülk başına en fazla iki; iki doğrudan talep onay bekliyor", () => {
    let booked = 0;
    for (let d = 0; d < 30; d++) {
      const k = addNights(ds.todayKey, d);
      for (const p of ds.properties) {
        if (live.some((r) => r.propertyId === p.id && key(r.arrivalDate) <= k && k < key(r.departureDate))) booked++;
      }
    }
    expect(booked / (30 * ds.properties.length)).toBeGreaterThanOrEqual(0.6);
    for (const p of ds.properties) {
      expect(ds.reservations.filter((r) => r.propertyId === p.id && r.status === "cancelled").length).toBeLessThanOrEqual(DEMO_MAX_CANCELLED_PER_PROPERTY);
    }
    const pending = ds.reservations.filter((r) => r.status === "pending");
    expect(pending).toHaveLength(2);
    for (const r of pending) expect(r.channel).toBe("direct");
  });

  it("her gelecek konaklamanın hazırlık + temizlik görevi var (panoda 'eksik görev' bandı çıkmaz)", () => {
    for (const r of live) {
      const own = ds.tasks.filter((t) => t.reservationId === r.id).map((t) => t.type);
      if (key(r.arrivalDate) >= today) expect(own, r.id).toContain("checkin_prep");
      if (key(r.departureDate) >= today) expect(own, r.id).toContain("cleaning");
    }
  });

  it("tekrar eden misafir: aynı dış kimlik iki farklı mülkte", () => {
    const returning = ds.reservations.filter((r) => r.guestExternalId !== null);
    expect(returning).toHaveLength(2);
    expect(new Set(returning.map((r) => r.propertyId)).size).toBe(2);
  });
});

describe("betik kararı (yıkıcı betik ÇALIŞTIRILMADAN sınanır)", () => {
  const LOCAL = "postgresql://postgres@localhost:5434/lixus_dev";
  const REMOTE = "postgresql://u:p@db.example.net:5432/app";
  const PW = "x".repeat(24);

  it.each([
    [{ DATABASE_URL: LOCAL }, { mode: "dry_run" }],
    [{ DATABASE_URL: LOCAL, DEMO_TENANT_APPLY: "1" }, { mode: "refuse", reason: "expect_org_mismatch" }],
    [{ DATABASE_URL: LOCAL, DEMO_TENANT_APPLY: "1", DEMO_TENANT_EXPECT_ORG: "baska-org" }, { mode: "refuse", reason: "expect_org_mismatch" }],
    [{ DATABASE_URL: LOCAL, DEMO_TENANT_APPLY: "1", DEMO_TENANT_EXPECT_ORG: DEMO_ORG_ID }, { mode: "apply" }],
    [{ DATABASE_URL: REMOTE, DEMO_TENANT_APPLY: "1", DEMO_TENANT_EXPECT_ORG: DEMO_ORG_ID }, { mode: "refuse", reason: "remote_host_unconfirmed" }],
    [{ DATABASE_URL: REMOTE, DEMO_TENANT_APPLY: "1", DEMO_TENANT_EXPECT_ORG: DEMO_ORG_ID, DEMO_TENANT_REMOTE_HOST: "db.example.org" }, { mode: "refuse", reason: "remote_host_unconfirmed" }],
    [{ DATABASE_URL: REMOTE, DEMO_TENANT_APPLY: "1", DEMO_TENANT_EXPECT_ORG: DEMO_ORG_ID, DEMO_TENANT_REMOTE_HOST: "db.example.net" }, { mode: "apply" }],
    [{ DATABASE_URL: REMOTE }, { mode: "dry_run" }], // kuru koşu uzakta da güvenli (yalnız sayar)
    [{ DATABASE_URL: LOCAL, DEMO_TENANT_PASSWORD: "kisa" }, { mode: "refuse", reason: "password_too_short" }],
    [{ DATABASE_URL: LOCAL, DEMO_TENANT_APPLY: "1", DEMO_TENANT_EXPECT_ORG: DEMO_ORG_ID, DEMO_TENANT_ROTATE_PASSWORD: "1" }, { mode: "refuse", reason: "rotate_without_password" }],
    [{ DATABASE_URL: "" }, { mode: "refuse", reason: "bad_database_url" }],
    [{}, { mode: "refuse", reason: "bad_database_url" }],
  ])("%j → %j", (env, expected) => {
    expect(decideDemoRun(env)).toMatchObject(expected);
  });

  it("şifre ve bayraklar karara taşınır", () => {
    expect(
      decideDemoRun({ DATABASE_URL: LOCAL, DEMO_TENANT_APPLY: "1", DEMO_TENANT_EXPECT_ORG: DEMO_ORG_ID, DEMO_TENANT_PASSWORD: PW, DEMO_TENANT_ROTATE_PASSWORD: "1", DEMO_TENANT_RESET_SECURITY: "1" }),
    ).toEqual({ mode: "apply", password: PW, rotatePassword: true, resetSecurity: true });
  });
});

describe("mimari pinler", () => {
  const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

  it("🚨 uygulama çekirdeğindeki HER silme demo org'uyla kapsanır", () => {
    const src = read("src/lib/demo-tenant/apply-core.ts");
    const calls = [...src.matchAll(/\.deleteMany\(\{[^\n]*\n?/g)].map((m) => m[0]);
    expect(calls.length).toBeGreaterThanOrEqual(14);
    for (const c of calls) expect(c, c).toContain("DEMO_ORG_ID");
  });

  it("demo modülleri betikten çalışır: server-only / db / sağlayıcı modülü içe aktarmaz", () => {
    for (const rel of ["constants.ts", "dataset.ts", "apply-core.ts", "cli.ts"]) {
      const src = read(`src/lib/demo-tenant/${rel}`);
      // Sağlayıcı MODÜLÜ içe aktarılmaz; org kolonları yalnız "canlı bağlantı varsa DOKUNMA" kontrolü için okunur.
      expect(src, rel).not.toMatch(/(?:import|from)\s*["'](?:server-only|@\/lib\/db|@\/lib\/hospitable[^"']*|@\/lib\/channels[^"']*)["']/);
      expect(src, rel).not.toMatch(/\bfetch\(/);
    }
  });

  it("KONTROL: yukarıdaki içe aktarma deseni gerçekten yakalar (vakumlu değil)", () => {
    const re = /(?:import|from)\s*["'](?:server-only|@\/lib\/db|@\/lib\/hospitable[^"']*|@\/lib\/channels[^"']*)["']/;
    expect(re.test('import "server-only";')).toBe(true);
    expect(re.test('import { prisma } from "@/lib/db";')).toBe(true);
    expect(re.test('import { x } from "@/lib/hospitable-credentials";')).toBe(true);
  });

  it("görev fotoğrafı yolu depolama modülüyle AYNI (o modül server-only; kopya eşitliği pinli)", () => {
    expect(DEMO_STORAGE_PHOTO_URL_PREFIX).toBe(STORAGE_PHOTO_URL_PREFIX);
  });
});
