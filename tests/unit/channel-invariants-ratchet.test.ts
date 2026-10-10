import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// KURUCU TALİMATI 09-07 — "20 teknik değişmez (test-pinli olacak)": pin eşlemesinde (10-10, Haiku taraması) iki boşluk vardı.
// Bugünkü bilinen ihlaller migration / operatör planı ister (migration 60 kanal kimliği tablosu; V0.7 org kolonları Aşama 1–3), bu
// yüzden pin "BÜYÜYEMEZ LİSTE"dir: bilinen ihlal gerekçesiyle listede durur; YENİ ihlal kırmızı; düzelen ama listede kalan satır da
// kırmızı (liste kendiliğinden küçülür, ölü izin kalmaz).
//  · Değişmez 3: dış kimlik global / yalnız mülk kapsamlı EŞSİZ sayılmaz — idempotency kapsamı bağlantıyı içerir.
//  · Değişmez 20: çekirdek `hospitable*` ŞEMA alanı okumaz (sağlayıcı modülü importu V0.8 pininde, `core-channel-independence`).
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../..");
const SCHEMA = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");

/** Şemadaki bütün eşsizlik kısıtları: alan düzeyi `@unique` ve model düzeyi `@@unique([...])`. */
function uniqueConstraints(schema: string): { model: string; fields: string[] }[] {
  const out: { model: string; fields: string[] }[] = [];
  let model = "";
  for (const raw of schema.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "");
    const m = /^model\s+(\w+)\s*\{/.exec(line);
    if (m) {
      model = m[1];
      continue;
    }
    if (/^\}/.test(line)) {
      model = "";
      continue;
    }
    if (!model) continue;
    const block = /@@unique\(\s*\[([^\]]+)\]/.exec(line);
    if (block) {
      out.push({ model, fields: block[1].split(",").map((f) => f.trim()).filter(Boolean) });
      continue;
    }
    const field = /^\s+(\w+)\s+\S+.*@unique\b/.exec(line);
    if (field) out.push({ model, fields: [field[1]] });
  }
  return out;
}

/** Sağlayıcının verdiği dış kimlik alanı (ad kalıbı). */
const EXTERNAL_ID = /^(?:external\w*|hospitable\w*|sourceReference|provider\w*Id|\w*ListingId)$/;
/** Bağlantı kapsamı: kanal bağlantısı ya da takvim kaynağı (iCal'in bağlantı karşılığı). */
const CONNECTION_SCOPE = new Set(["connectionId", "channelConnectionId", "calendarSourceId"]);

/** Bağlantı kapsamı taşımayan dış kimlik eşsizlikleri — gerekçeli: bilinen ihlal (düzeltme planı yanında) ya da kapsam dışı. */
const KNOWN_GLOBAL_OR_PROPERTY_IDS: Record<string, string> = {
  "WebhookEvent:providerEventId": "KAPSAM DIŞI: ödeme sağlayıcısının (iyzico / Paddle) webhook olay kimliği — kanal kimliği değil",
  "Property:hospitableId": "köprü mülk kimliği global eşsiz — bağlantı kapsamlı ilan tablosu migration 60 paketinde (kurucu onayı bekliyor)",
  "Reservation:propertyId,sourceReference": "iCal UID mülk kapsamlı — elle .ics satırı kaynaksız (calendarSourceId NULL); kaynak kapsamı ayrı karar",
  "Conversation:propertyId,externalReservationId": "konuşma kimliği mülk + rezervasyon — bağlantı kapsamı V0.7 kolon sözleşmesinden sonra",
  "Message:conversationId,externalId": "mesaj kimliği konuşma kapsamlı (konuşma mülk kapsamlı) — yukarıdakiyle birlikte taşınır",
};

describe("değişmez 3 — dış kimlik bağlantı kapsamsız eşsiz sayılmaz (büyüyemez liste)", () => {
  const all = uniqueConstraints(SCHEMA);

  it("ayrıştırıcı gerçekten kısıt buluyor (pin boşa düşmesin)", () => {
    expect(all.length).toBeGreaterThanOrEqual(20);
    expect(all).toContainEqual({ model: "Property", fields: ["hospitableId"] });
  });

  it("🚨 dış kimlik içeren her eşsizlik kısıtı ya bağlantı kapsamını taşır ya da gerekçeli bilinen ihlaldir; liste ölü satır taşımaz", () => {
    const offenders = all
      .filter((c) => c.fields.some((f) => EXTERNAL_ID.test(f)) && !c.fields.some((f) => CONNECTION_SCOPE.has(f)))
      .map((c) => `${c.model}:${c.fields.join(",")}`)
      .sort();
    expect(offenders).toEqual(Object.keys(KNOWN_GLOBAL_OR_PROPERTY_IDS).sort());
  });
});

/** src/ altındaki .ts / .tsx dosyaları (göreli, "/" ayraçlı). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(path.relative(ROOT, p).split(path.sep).join("/"));
  }
  return out;
}

/** Şemanın `hospitable*` alanları (yerel değişken adları değil). */
const HOSPITABLE_FIELDS = [...SCHEMA.matchAll(/^\s+(hospitable\w*)\s+\S+/gm)].map((m) => m[1]);

/** Sağlayıcı sınırı: Channel Layer + sağlayıcı istemcisi / yardımcıları — burada okumak serbest. */
const isProviderBoundary = (rel: string) => rel.startsWith("src/lib/channels/") || /^src\/lib\/hospitable[\w-]*\.ts$/.test(rel);

/** Bilinen çekirdek okuyucular (değişmez 20) — gerekçeli; V0.7 org kolonlarının kaldırılması operatör planı Aşama 1–3'e bağlı. */
const KNOWN_CORE_READERS: Record<string, string> = {
  "src/app/api/hospitable/diagnostics/route.ts": "sağlayıcı adlı operatör teşhis rotası (V0.6 pininde de gerekçeli)",
  "src/app/(app)/admin/page.tsx": "operatör paneli bağlantı etiketi: bağlantı satırı yoksa org jeton kolonu (V0.7 çift kaynak)",
  "src/app/(app)/properties/page.tsx": "mülk hazırlık rozetinde 'kanal bağlı mı' (hospitableId ya da takvim kaynağı; ilan tablosu migration 60)",
  "src/lib/reservations-cleanup.ts": "köprüde silinmiş rezervasyonu bulmak için köprü mülk kimliğiyle adaptör okuması (ilan tablosu migration 60)",
  "src/lib/demo-tenant/apply-core.ts": "gerçek bağlantısı olan kuruluşa demo üreticisi DOKUNMAZ (jeton kolonu + bağlantı satırı kontrolü; güvenlik kemeri)",
  "src/lib/unverified-sweep.ts": "terk edilmiş hesap temizliği bağlanmış hesabı 'el değmiş' sayar (org kolonları + bağlantı satırı, V0.7 çift kaynak)",
  "src/lib/scheduled-sync.ts": "senkron edilecek kuruluş seçimi: jeton kolonu ya da aktif bağlantı satırı (V0.7 çift kaynak)",
};

describe("değişmez 20 — çekirdek `hospitable*` şema alanı okumaz (büyüyemez liste)", () => {
  it("şemanın sağlayıcı alanları bulunuyor (pin boşa düşmesin)", () => {
    expect(HOSPITABLE_FIELDS).toEqual(expect.arrayContaining(["hospitableId", "hospitableTokenEnc"]));
  });

  it("🚨 sınır dışında `hospitable*` şema alanı okuyan dosyalar = gerekçeli bilinen liste; yeni okuyucu kırmızı, düzelen satır listeden çıkar", () => {
    const field = new RegExp(`\\b(?:${HOSPITABLE_FIELDS.join("|")})\\b`);
    const readers = sourceFiles(path.join(ROOT, "src"))
      .filter((rel) => !isProviderBoundary(rel))
      // Yorumlar sayılmaz (bir yorumda alanın adını anmak okumak değildir).
      .filter((rel) => field.test(readFileSync(path.join(ROOT, rel), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")))
      .sort();
    expect(readers).toEqual(Object.keys(KNOWN_CORE_READERS).sort());
  });
});
