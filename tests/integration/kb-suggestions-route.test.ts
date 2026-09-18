import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma, resetDb, makeOrgWithProperty } from "../helpers/db";
import type { SessionPayload } from "@/lib/auth";

let session: SessionPayload;
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return { ...actual, requireSession: vi.fn(async () => session) };
});

import { GET } from "@/app/api/kb/suggestions/route";
import { HISTORY_MESSAGE_CAP as MESSAGE_CAP } from "@/lib/kb-suggestions-flag";
import { DEFAULT_TEMPLATES } from "@/lib/templates";

// ---------------------------------------------------------------------------
// KNOWLEDGE HUB BACAK B — OKUMA ROTASI (uçtan uca, GERÇEK DB).
//
// Saf çekirdek `tests/unit/kb-from-history.test.ts`'te pinli. Burada ölçülen şey
// ROTANIN kendisi: kiracı kapsamı, gerçek Prisma seçimi ve YAZMA YOKLUĞU.
//
// 🚨 KİRACI İZOLASYONU CLAUDE.md'de her yeni yol için ZORUNLU davranışsal test.
// ---------------------------------------------------------------------------

const req = (qs = "") => new NextRequest(`http://localhost/api/kb/suggestions${qs}`);
/** Rota ikinci argüman (route ctx) bekler; bu uçta dinamik parametre yok. */
const ctx = { params: Promise.resolve({}) } as never;

async function seedOrg(name: string) {
  const { orgId, propertyId } = await makeOrgWithProperty();
  await prisma.property.update({ where: { id: propertyId }, data: { name } });
  const user = await prisma.user.create({
    data: { organizationId: orgId, name: "O", email: `${name}-${Math.random()}@x.com`, passwordHash: "x", role: "owner" },
  });
  return { orgId, propertyId, userId: user.id };
}

let seq = 0;
/** Bir soru→cevap turu yazar; cevabı host mu AI mı yazdı seçilebilir. */
async function writeTurn(
  propertyId: string,
  question: string,
  answer: string,
  over: { senderName?: string; aiAssisted?: boolean; status?: string } = {},
) {
  seq += 1;
  const conv = await prisma.conversation.create({
    data: {
      propertyId,
      guestIdentifier: `g${seq}`,
      status: over.status ?? "answered",
      lastMessageAt: new Date(),
    },
  });
  const base = Date.now() - seq * 3_600_000;
  await prisma.message.create({
    data: {
      conversationId: conv.id,
      direction: "inbound",
      authorType: "guest",
      senderName: "Misafir",
      body: question,
      createdAt: new Date(base),
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conv.id,
      direction: "outbound",
      authorType: over.senderName ? null : "host",
      senderName: over.senderName ?? "Musa",
      aiAssisted: over.aiAssisted ?? false,
      body: answer,
      createdAt: new Date(base + 60_000),
    },
  });
  return conv.id;
}

const body = async (r: Response) => (await r.json()) as {
  suggestions: { propertyId: string; propertyName: string | null; category: string; answer: string; occurrences: number }[];
  fromTemplates: {
    propertyId: string;
    propertyName: string | null;
    category: string;
    content: string;
    fromOrgWide: boolean;
  }[];
  scanned: number | null;
  capped: boolean;
};

describe("GET /api/kb/suggestions — Bacak B okuma rotası", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    // 🚨 Geçmiş bacağı ÜRETİMDE KAPALI (dış denetim 09-18). Bu blok bacağın
    // KENDİ davranışını ölçüyor, o yüzden açıkça açılır; kapalı hâlin sözleşmesi
    // aşağıda AYRI bir blokta pinli.
    vi.stubEnv("KB_HISTORY_SUGGESTIONS_ENABLED", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("host iki kez cevaplamışsa ÖNERİ döner, mülk adıyla", async () => {
    const a = await seedOrg("Lale 1");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await writeTurn(a.propertyId, "Wifi şifresi nedir?", "Ağ LaleApt, şifre 12345678.");
    await writeTurn(a.propertyId, "wifi parolası ne acaba", "Şifre 12345678.");

    const out = await body(await GET(req(), ctx));
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0].category).toBe("wifi");
    expect(out.suggestions[0].occurrences).toBe(2);
    expect(out.suggestions[0].propertyName).toBe("Lale 1");
    expect(out.suggestions[0].answer).toContain("12345678");
  });

  it("🚨 KİRACI İZOLASYONU: başka org'un cevapları HİÇ görünmez", async () => {
    const a = await seedOrg("A dairesi");
    const b = await seedOrg("B dairesi");
    // B org'unda bol bol cevap var…
    await writeTurn(b.propertyId, "Wifi şifresi nedir?", "B-ORG-SIFRESI-9999.");
    await writeTurn(b.propertyId, "wifi parolası ne acaba", "B-ORG-SIFRESI-9999.");
    await writeTurn(b.propertyId, "Otopark var mı?", "B org otoparkı bina altında.");
    await writeTurn(b.propertyId, "park yeri var mı", "B org otoparkı bina altında.");

    // …ama A org'unun oturumuyla bakıyoruz.
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    const out = await body(await GET(req(), ctx));
    expect(out.suggestions).toEqual([]);
    expect(JSON.stringify(out), "başka kiracının metni sızdı").not.toContain("B-ORG-SIFRESI");
    expect(out.scanned).toBe(0);
  });

  it("🚨 KENDİ AI ÇIKTIMIZ öneri üretmez (gerçek DB satırlarıyla)", async () => {
    const a = await seedOrg("Lale 2");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await writeTurn(a.propertyId, "Wifi şifresi nedir?", "Şifre AAA.", { senderName: "Lixus AI" });
    await writeTurn(a.propertyId, "wifi parolası ne acaba", "Şifre AAA.", { senderName: "GuestOps AI" });
    await writeTurn(a.propertyId, "wifi şifresi?", "Şifre AAA.", { aiAssisted: true });

    const out = await body(await GET(req(), ctx));
    expect(out.suggestions).toEqual([]);
    expect(out.scanned, "mesajlar okundu ama hiçbiri host cevabı sayılmadı").toBeGreaterThan(0);
  });

  it("'sorunlu' konuşma öneriye girmez (gerçek DB durumu)", async () => {
    const a = await seedOrg("Lale 3");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await writeTurn(a.propertyId, "Wifi şifresi nedir?", "Şifre İYİ-CEVAP.");
    await writeTurn(a.propertyId, "wifi parolası ne acaba", "Modem arızalı, kusura bakmayın.", { status: "problem" });

    const out = await body(await GET(req(), ctx));
    expect(out.suggestions, "tek geçerli cevap eşiği geçmemeli").toEqual([]);
    expect(JSON.stringify(out)).not.toContain("arızalı");
  });

  it("propertyId filtresi çalışır ve KAPSAM DIŞINA çıkmaz", async () => {
    const a = await seedOrg("Lale 4");
    const other = await prisma.property.create({
      data: { organizationId: a.orgId, name: "Lale 5", checkInTime: "15:00", checkOutTime: "11:00" },
    });
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await writeTurn(a.propertyId, "Wifi şifresi nedir?", "P4 şifresi AAA.");
    await writeTurn(a.propertyId, "wifi parolası ne acaba", "P4 şifresi AAA.");
    await writeTurn(other.id, "Otopark var mı?", "P5 otoparkı altta.");
    await writeTurn(other.id, "park yeri var mı", "P5 otoparkı altta.");

    const only = await body(await GET(req(`?propertyId=${other.id}`), ctx));
    expect(only.suggestions.map((s) => s.category)).toEqual(["parking"]);
    expect(JSON.stringify(only)).not.toContain("P4 şifresi");

    const all = await body(await GET(req(), ctx));
    expect(all.suggestions).toHaveLength(2);
  });

  it("🚨 SALT OKUMA: rota hiçbir KB kalemi ya da mesaj YAZMAZ", async () => {
    const a = await seedOrg("Lale 6");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await writeTurn(a.propertyId, "Wifi şifresi nedir?", "Şifre AAA.");
    await writeTurn(a.propertyId, "wifi parolası ne acaba", "Şifre AAA.");

    const before = {
      kb: await prisma.knowledgeBaseItem.count(),
      msg: await prisma.message.count(),
      conv: await prisma.conversation.count(),
    };
    await GET(req(), ctx);
    expect({
      kb: await prisma.knowledgeBaseItem.count(),
      msg: await prisma.message.count(),
      conv: await prisma.conversation.count(),
    }).toEqual(before);
  });

  it("🚨 ŞABLON KAYNAĞI: host'un yazdığı Wi-Fi şablonu öneri olur", async () => {
    // Kurucu kararı 09-11: "AI'yı boş bilgiyle açtırma" KAPISI REDDEDİLDİ;
    // doğrusu bilgiyi host'un ZATEN yazdığı yerden bulmak. Şablon misafire aynen
    // gider ama MODELDEN HİÇ GEÇMEZ — bu yol o boşluğu kapatır.
    const a = await seedOrg("Lale 8");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await prisma.messageTemplate.create({
      data: {
        organizationId: a.orgId,
        propertyId: a.propertyId,
        category: "wifi",
        title: "Wi-Fi bilgisi",
        body: "Ağ adı LaleApt, şifre 12345678. Modem salonda.",
      },
    });

    const out = await body(await GET(req(), ctx));
    expect(out.fromTemplates).toHaveLength(1);
    expect(out.fromTemplates[0]).toMatchObject({ propertyId: a.propertyId, category: "wifi", fromOrgWide: false });
    expect(out.fromTemplates[0].content).toContain("12345678");
  });

  it("🚨 VARSAYILAN ŞABLONLAR ÖNERİLMEZ — DB'ye SEED EDİLSE BİLE", async () => {
    // İki ayrı savunma var ve ikincisi de ÖLÇÜLÜR:
    //  ① `DEFAULT_TEMPLATES` KODDA sabittir, okuma anında birleştirilir; rota
    //    `prisma.messageTemplate` okur, yani normalde hiç görmez.
    //  ② Biri onları DB'ye seed etse bile HEPSİ `{{…}}` iskelesidir ve bacak
    //    reddeder. (Eski hâlinde bu testin ilk iddiası `resetDb` sonrası satır
    //    sayısıydı — FİKSTÜRÜ ölçüyordu, kuralı değil.)
    const a = await seedOrg("Lale 10");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };

    const allowlisted = DEFAULT_TEMPLATES.filter((t) => t.category === "wifi" || t.category === "rules");
    expect(allowlisted.length, "allowlist kategorisinde varsayılan yoksa ölçüm boş").toBeGreaterThan(0);
    await prisma.messageTemplate.createMany({
      data: allowlisted.map((t) => ({
        organizationId: a.orgId,
        propertyId: a.propertyId,
        category: t.category,
        title: t.title,
        body: t.body,
        language: t.language,
      })),
    });

    const out = await body(await GET(req(), ctx));
    expect(out.fromTemplates, "varsayılan iskele öneriye sızdı").toEqual([]);
    expect(JSON.stringify(out), "{{wifiInfo}} gibi işaretçiler öneriye giremez").not.toContain("{{");
  });

  it("🚨 ONAYSIZ TASLAK kategoriyi DOLU göstermez (asistan onu okuyamaz)", async () => {
    const a = await seedOrg("Lale 11");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await prisma.knowledgeBaseItem.create({
      data: { propertyId: a.propertyId, category: "wifi", title: "Taslak", content: "Henüz onaysız.", reviewState: "draft" },
    });
    await prisma.messageTemplate.create({
      data: { organizationId: a.orgId, propertyId: a.propertyId, category: "wifi", title: "Wi-Fi", body: "Ağ LaleApt, şifre 12345678." },
    });

    const out = await body(await GET(req(), ctx));
    expect(out.fromTemplates, "taslak boşluğu kapatmış sayıldı").toHaveLength(1);
  });

  it("🚨 propertyId filtresi ŞABLON bacağında da geçerli (org geneli hariç)", async () => {
    const a = await seedOrg("Lale 12");
    const other = await prisma.property.create({
      data: { organizationId: a.orgId, name: "Lale 13", checkInTime: "15:00", checkOutTime: "11:00" },
    });
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await prisma.messageTemplate.create({
      data: { organizationId: a.orgId, propertyId: a.propertyId, category: "wifi", title: "Wi-Fi", body: "BIRINCI-MULK-SIFRESI-1111" },
    });
    await prisma.messageTemplate.create({
      data: { organizationId: a.orgId, propertyId: null, category: "rules", title: "Kurallar", body: "Sigara içilmez, evcil hayvan kabul edilmez." },
    });

    const only = await body(await GET(req(`?propertyId=${other.id}`), ctx));
    expect(JSON.stringify(only), "başka mülkün şablonu sızdı").not.toContain("BIRINCI-MULK");
    expect(
      only.fromTemplates.map((s: { propertyId: string; category: string }) => `${s.propertyId}|${s.category}`),
      "org geneli şablon seçili mülke önerilmeli",
    ).toEqual([`${other.id}|rules`]);
  });

  it("🚨 KİRACI İZOLASYONU şablon bacağında da geçerli", async () => {
    const a = await seedOrg("A sablon");
    const b = await seedOrg("B sablon");
    await prisma.messageTemplate.create({
      data: {
        organizationId: b.orgId,
        propertyId: b.propertyId,
        category: "wifi",
        title: "Wi-Fi",
        body: "B-ORG-SABLON-SIFRESI-7777",
      },
    });
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };

    const out = await body(await GET(req(), ctx));
    expect(out.fromTemplates).toEqual([]);
    expect(JSON.stringify(out), "başka kiracının şablonu sızdı").not.toContain("B-ORG-SABLON");
  });

  it("mülkte O KATEGORİDE kalem varsa şablon ÖNERİLMEZ (çift kopya yok)", async () => {
    const a = await seedOrg("Lale 9");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await prisma.knowledgeBaseItem.create({
      data: { propertyId: a.propertyId, category: "wifi", title: "Wi-Fi", content: "Zaten var." },
    });
    await prisma.messageTemplate.create({
      data: { organizationId: a.orgId, propertyId: a.propertyId, category: "wifi", title: "Wi-Fi", body: "Sablon metni." },
    });

    const out = await body(await GET(req(), ctx));
    expect(out.fromTemplates).toEqual([]);
  });

  it("veri yoksa boş döner (çökmez)", async () => {
    const a = await seedOrg("Lale 7");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    const out = await body(await GET(req(), ctx));
    expect(out.suggestions).toEqual([]);
    expect(out.scanned).toBe(0);
    expect(out.capped).toBe(false);
  });

  it("🚨 İÇ MESAJ KİMLİKLERİ GÖVDEYE KONMAZ (bulgu 10)", async () => {
    const a = await seedOrg("Lale 10");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    const c1 = await writeTurn(a.propertyId, "Wifi şifresi nedir?", "Şifre AAA.");
    await writeTurn(a.propertyId, "wifi parolası ne acaba", "Şifre AAA.");

    const res = await GET(req(), ctx);
    const raw = await res.text();
    expect(JSON.parse(raw).suggestions).toHaveLength(1);
    expect(raw, "sourceMessageIds tel üzerinden gidiyor").not.toContain("sourceMessageIds");
    expect(raw, "lastAnsweredAt hiçbir yüzeyde okunmuyor").not.toContain("lastAnsweredAt");
    // Anti-vakumluk: kimliklerin GERÇEKTEN var olduğu ve gövdede geçmediği ayrı iddia.
    const anyMsgId = (await prisma.message.findFirst({ where: { conversationId: c1 } }))!.id;
    expect(anyMsgId.length).toBeGreaterThan(0);
    expect(raw).not.toContain(anyMsgId);
  });

  it("🚨 MEVCUT KB ÖNERİYİ BASTIRIR (bulgu 2) — rota `existingKb`i geçmiş bacağına da verir", async () => {
    const a = await seedOrg("Lale 11");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await writeTurn(a.propertyId, "Wifi şifresi nedir?", "Şifre AAA.");
    await writeTurn(a.propertyId, "wifi parolası ne acaba", "Şifre AAA.");
    // Önce öneri VAR (anti-vakumluk).
    expect((await body(await GET(req(), ctx))).suggestions).toHaveLength(1);

    // Host öneriyi kabul etti → aynı mülk+kategoride onaylı kalem oluştu.
    await prisma.knowledgeBaseItem.create({
      data: {
        propertyId: a.propertyId,
        category: "wifi",
        title: "Wi-Fi",
        content: "Şifre AAA.",
        reviewState: "approved",
      },
    });
    expect(
      (await body(await GET(req(), ctx))).suggestions,
      "'Yeniden tara' aynı öneriyi geri getiriyor → ikinci kez eklenirse çelişkili iki kalem",
    ).toEqual([]);
  });

  it("🚨 `capped` KESİN: tam tavanda false, tavanın üstünde true (bulgu 9)", async () => {
    const a = await seedOrg("Lale 12");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    const conv = await prisma.conversation.create({
      data: { propertyId: a.propertyId, guestIdentifier: "cap", status: "answered", lastMessageAt: new Date() },
    });
    const row = (i: number) => ({
      conversationId: conv.id,
      direction: "inbound",
      authorType: "guest",
      senderName: "Misafir",
      body: `m${i}`,
      createdAt: new Date(Date.now() - i * 1_000),
    });
    await prisma.message.createMany({ data: Array.from({ length: MESSAGE_CAP }, (_, i) => row(i)) });
    expect((await body(await GET(req(), ctx))).capped, "TAM tavan 'kesildi' DEĞİLDİR").toBe(false);

    await prisma.message.createMany({ data: [row(MESSAGE_CAP)] });
    expect((await body(await GET(req(), ctx))).capped).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 🚨 KAPALI YÜZEY SÖZLEŞMESİ (dış denetim 09-18).
//
// Kart 09-11'de söküldü ama ÖLÇÜLDÜ: yalnız GÖSTERİM durmuştu. Rota geçmiş
// bacağını koşulsuz hesaplayıp tarayıcıya gönderiyordu ve bunun bedelini BUGÜN
// CANLI olan şablon kartı ödüyordu (her "Tara" 3.000 satırlık sorgu).
// ---------------------------------------------------------------------------
describe("🚨 geçmiş bacağı VARSAYILAN KAPALI", () => {
  beforeEach(async () => {
    await resetDb();
    vi.clearAllMocks();
    vi.unstubAllEnvs(); // bayrak YOK — üretim hâli
  });

  it("bayrak yokken öneri ÜRETİLMEZ ve MESAJ SORGUSU HİÇ KOŞMAZ", async () => {
    const a = await seedOrg("Lale 13");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await writeTurn(a.propertyId, "Wifi şifresi nedir?", "Şifre GIZLI-AAA.");
    await writeTurn(a.propertyId, "wifi parolası ne acaba", "Şifre GIZLI-AAA.");

    const spy = vi.spyOn(prisma.message, "findMany");
    const out = await body(await GET(req(), ctx));
    expect(out.suggestions).toEqual([]);
    expect(JSON.stringify(out), "host cevabı hâlâ tele gidiyor").not.toContain("GIZLI-AAA");
    // 🚨 ASIL İDDİA: tarama hiç yapılmadı — şablon kartı geçmiş bacağının
    // bedelini ödemez.
    expect(spy, "3.000 satırlık sorgu kapalı bacak için koşuyor").not.toHaveBeenCalled();
    // 🚨 `null` = ÖLÇÜLMEDİ (A2 deyimi), `0` DEĞİL: "sıfır mesaj tarandı" ile
    // "tarama hiç yapılmadı" FARKLI iddialardır.
    expect(out.scanned).toBeNull();
    spy.mockRestore();
  });

  it("ŞABLON BACAĞI BAYRAKTAN ETKİLENMEZ (canlı kart aynen çalışır)", async () => {
    const a = await seedOrg("Lale 14");
    session = { userId: a.userId, organizationId: a.orgId, role: "owner", email: "a@x.com", name: "O", sessionEpoch: 0 };
    await prisma.messageTemplate.create({
      data: {
        organizationId: a.orgId,
        propertyId: a.propertyId,
        category: "wifi",
        title: "Wi-Fi bilgisi",
        body: "Ağ adı LaleApt, şifre 12345678. Modem salonda.",
      },
    });
    const out = await body(await GET(req(), ctx));
    expect(out.fromTemplates).toHaveLength(1);
    expect(out.fromTemplates[0].content).toContain("12345678");
  });
});
