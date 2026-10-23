#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// SALT-OKUMA TEŞHİS — Hospitable rezervasyonunda kişi / evcil hayvan SAYI alanlarının ADLARI (migration 86).
//
// HİÇBİR ŞEY YAZMAZ. Veritabanından yalnız işletmenin bağlı mülk kimliklerini okur, Hospitable'dan son rezervasyonları ister ve
// YALNIZ ALAN ADLARINI + tiplerini + kaç rezervasyonda geçtiklerini basar. Değer, ad, e-posta, telefon, kimlik BASILMAZ.
//
// Amaç: `HOSPITABLE_GUEST_COUNTS_ENABLED` açılmadan önce, `channels/hospitable-ingest.ts guestPartyOf`ın okuduğu
// `guests.adult_count / child_count / infant_count / pet_count` adlarının gerçek yanıtta bulunduğunu görmek (kurucu: "doğrulayamazsam boş
// kalır, uydurma yok"). Adlar farklıysa eşleme düzeltilir, anahtar o zaman açılır.
//
// Kullanım (Railway açıldıktan sonra, prod ortamında):
//   DATABASE_URL=... ENCRYPTION_KEY=... ORG_ID=<işletme kimliği> npx tsx scripts/diagnose-hospitable-guest-fields.ts
// Çıkış kodu: `guests` nesnesi hiç görülmediyse 1, görüldüyse 0.
// ---------------------------------------------------------------------------
import { PrismaClient } from "@prisma/client";
import { getOrgHospitableToken } from "../src/lib/hospitable-credentials";
import { listReservations } from "../src/lib/hospitable";

const prisma = new PrismaClient();

/** Bir değerin yalnız TİPİ (değer basılmaz). */
function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

async function main() {
  const orgId = process.env.ORG_ID?.trim();
  if (!orgId) throw new Error("ORG_ID gerekli");
  const token = await getOrgHospitableToken(orgId);
  if (!token) throw new Error("Bu işletmenin Hospitable bağlantısı yok");
  const props = await prisma.property.findMany({ where: { organizationId: orgId, hospitableId: { not: null } }, select: { hospitableId: true } });
  const propertyIds = props.map((p) => p.hospitableId!).slice(0, 20);
  const start = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
  const reservations = (await listReservations({ propertyIds, startDate: start, endDate: end }, token)).slice(0, 50);

  const top = new Map<string, Set<string>>();
  const guests = new Map<string, Set<string>>();
  let withGuests = 0;
  for (const r of reservations) {
    for (const [k, v] of Object.entries(r)) {
      if (!/guest|adult|child|infant|pet|occupan|people|person/i.test(k)) continue;
      top.set(k, (top.get(k) ?? new Set()).add(typeOf(v)));
    }
    const g = (r as { guests?: unknown }).guests;
    if (g && typeof g === "object" && !Array.isArray(g)) {
      withGuests += 1;
      for (const [k, v] of Object.entries(g as Record<string, unknown>)) guests.set(k, (guests.get(k) ?? new Set()).add(typeOf(v)));
    }
  }
  console.log("== Hospitable kişi sayısı alanları (SALT-OKUMA; değer basılmaz) ==");
  console.log(`incelenen rezervasyon : ${reservations.length}`);
  console.log(`'guests' nesnesi olan : ${withGuests}`);
  console.log("\nÜst düzey ilgili alanlar (ad : tipler):");
  for (const [k, t] of top) console.log(`  ${k} : ${[...t].join(", ")}`);
  console.log("\n'guests' nesnesinin alanları (ad : tipler):");
  for (const [k, t] of guests) console.log(`  ${k} : ${[...t].join(", ")}`);
  const expected = ["adult_count", "child_count", "infant_count", "pet_count"];
  console.log(`\nEşlemenin beklediği adlar: ${expected.map((k) => `${k}=${guests.has(k) ? "VAR" : "YOK"}`).join(" · ")}`);
  process.exitCode = withGuests > 0 ? 0 : 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
