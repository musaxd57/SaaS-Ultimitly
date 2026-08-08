import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { toAmountDec } from "@/lib/money";
import { isUniqueViolation } from "@/lib/db-errors";
import { badRequest, jsonOk, readFormDataCapped, payloadTooLarge, BodyTooLargeError, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { parseIcs } from "@/lib/import/ics";
import { parseCsv, CsvParseError } from "@/lib/import/csv";
import { createReservationTasks } from "@/lib/automation";
import { loadErasureGuard, acquireErasureLock } from "@/lib/erasure";

const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

export const POST = withManage(async (session, req) => {
  // OOM guard: read the multipart body with a HARD byte cap (Content-Length pre-check
  // + streaming cancel-on-overflow) so a several-hundred-MB .csv/.ics — even with a
  // missing/lying Content-Length or a chunked body — can't buffer into the shared
  // replica's memory before the per-file check below. Margin for the multipart envelope.
  let formData: FormData;
  try {
    formData = await readFormDataCapped(req, IMPORT_MAX_BYTES + 1024 * 1024);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return payloadTooLarge();
    return badRequest({ file: "Dosya okunamadı." });
  }
  const file = formData.get("file") as File | null;
  const propertyId = formData.get("propertyId") as string | null;

  if (!file) return badRequest({ file: "Dosya gerekli" });
  // Second line (for a missing/lying Content-Length): the per-file size cap, still
  // BEFORE file.text() buffers a second copy into a string.
  if (file.size > IMPORT_MAX_BYTES) return badRequest({ file: "Dosya çok büyük (en fazla 5 MB)." });
  if (!propertyId) return badRequest({ propertyId: "Mülk seçin" });

  // Verify the property belongs to this organization.
  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId: session.organizationId },
    select: { id: true },
  });
  if (!property) return badRequest({ propertyId: "Geçersiz mülk" });

  const fileName = file.name.toLowerCase();
  const isIcs = fileName.endsWith(".ics");
  const isCsv = fileName.endsWith(".csv");

  if (!isIcs && !isCsv) {
    return badRequest({ file: "Yalnızca .ics veya .csv dosyaları kabul edilir" });
  }

  // 🚨 HIZ LİMİTİ ŞART — KALDIRMA. Bu rota SATIR BAŞINA ~9 DB gidiş-dönüşü
  // yapıyor (dupe `findFirst` + advisory kilit + tombstone okuması + `create`
  // hepsi satır başına AYRI transaction'da, üstüne `createReservationTasks`'ın
  // 3 sorgusu) ve ayrıştırıcı tavanı 10.000 satır → tek istek ~90.000 ardışık
  // sorgu. Limitsizken bir deneme hesabı bunu ardışık ve eşzamanlı tekrarlayıp
  // PAYLAŞILAN Postgres'i tüm kiracılar için doyurabiliyordu.
  // Org başına: gerçek bir içe aktarım nadir ve elle yapılır, 5/saat cömert.
  //
  // ⚠️ BÜTÇE DOĞRULAMADAN SONRA TÜKETİLİR — YUKARI TAŞIMA. Deponun AI kotası
  // için 08-05'te verdiği kararla aynı: maliyet AŞAĞIDA başlıyor, dolayısıyla
  // bütçe de orada tüketilmeli. Rotanın en başındayken bozuk bir Airbnb
  // dışa aktarımını düzeltmeye çalışan host (ayrıştırıcı bilinçli fail-closed:
  // dengesiz tırnak / kaymış sütun reddedilir) beş denemede kotasını yakıp BİR
  // SAAT kilitli kalıyordu — üstelik tek satır bile içe aktarılmadan. Yanlış
  // dosya türü, yabancı mülk ve eksik alan artık ÜCRETSİZ reddediliyor.
  // Geriye kalan sınırsız yüzey yalnızca gövde okumasıdır ve o zaten sert bir
  // bayt tavanıyla sınırlı (istek başına ~6 MB), yani asıl DoS (90.000 sorgu)
  // tam olarak kapının arkasında kalıyor.
  const limited = await rateLimit(`reservation-import:${session.organizationId}`, 5, 60 * 60_000);
  if (!limited.ok) {
    return tooManyRequests(
      limited.retryAfter,
      // Süreyi SÖYLE: genel metin "kısa bir süre" diyor ama buradaki pencere
      // bir SAAT — host boşuna tekrar tekrar denemesin.
      `Saatte en fazla 5 içe aktarım yapılabilir. Yaklaşık ${Math.ceil(limited.retryAfter / 60)} dakika sonra tekrar deneyin.`,
    );
  }

  const text = await file.text();

  type ParsedRow = {
    guestName: string;
    arrivalDate: Date;
    departureDate: Date;
    sourceReference?: string | null;
    notes?: string | null;
    channel?: string;
    totalAmount?: number;
    currency?: string;
  };

  let rows: ParsedRow[] = [];
  if (isIcs) {
    // 🚨 KANAL EZİLMİYOR (denetim 08-07 (6)). Burada bir dönem `channel: "other"`
    // yazılıyordu — muhtemelen rozet ham "ics" göstermesin diye. Bedeli ağırdı:
    // yaşam-döngüsü gönderimleri `channel: { notIn: ["ics","manual"] }` ile
    // filtreliyor ("only Hospitable-messageable bookings — never iCal/manual"),
    // yani ELLE YÜKLENEN bir .ics satırı o kapıyı GEÇİYOR ve var olmayan bir
    // Hospitable konuşmasına karşılama/giriş mesajı denemesi başlatıyordu.
    // Aynı içerik abonelik senkronundan gelince `"ics"` yazılıyordu → aynı
    // dosya, iki farklı kanal. Rozet sorunu ETİKET HARİTASINA "ics" eklenerek
    // çözüldü (`constants.ts`), kanal değerini bükerek değil.
    rows = parseIcs(text);
  } else {
    // FAIL-CLOSED: a structurally broken CSV (unbalanced quote, shifted columns)
    // throws — surface a clear validation error and import NOTHING, rather than
    // writing values from the wrong columns.
    try {
      rows = parseCsv(text);
    } catch (err) {
      if (err instanceof CsvParseError) return badRequest({ file: err.message });
      return badRequest({ file: "CSV dosyası okunamadı." });
    }
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  // ── KVKK ERASURE INGRESS GUARD (denetim, 08-06) ───────────────────────────
  //
  // 🚨 BU ROTA ÜÇÜNCÜ BİR INGRESS YOLU ve tombstone kapısı YOKTU. `erasure.ts`'in
  // kendi başlık yorumu "every tombstone-scoped ingress writer (hospitable-sync,
  // iCal import)" diyerek İKİ yol sayıyordu — elle `.ics`/`.csv` yüklemesi
  // listede yoktu ve `loadErasureGuard`/`acquireErasureLock` bu dosyada HİÇ
  // geçmiyordu (grep: 0).
  //
  // Senaryo: misafir m.11 silme talebi yapar → host rezervasyonu siler
  // (`eraseReservationData` maskeler + tombstone yazar) → aylar sonra host
  // Airbnb dışa aktarımını TEKRAR yükler → aynı `sourceReference` ile silinmiş
  // konaklama misafirin GERÇEK adıyla geri doğar. Yönetmelik m.8 "tekrar
  // kullanılamaz" şartının doğrudan ihlali.
  //
  // ⚠️ KAPSAM SINIRI, DÜRÜSTÇE: bu kapı YALNIZ `sourceReference` üzerinden
  // koruyabilir. `blocksGuestStay` burada BİLİNÇLİ olarak çağrılmaz çünkü
  // ÇAĞRILSA DA ÖLÜ KOD olurdu: tombstone kişi-anahtarları e-posta / telefon /
  // sağlayıcı-id'dir (`TombstoneKeyInput`), ve İKİ ayrıştırıcı da bunların
  // HİÇBİRİNİ üretmiyor (kod-doğrulandı: `csv.ts` ve `ics.ts` yalnız
  // `sourceReference` çıkarır). Sonuç:
  //   · `.ics`  → UID daima var → TAM korunur
  //   · `.csv`  → yalnız referans sütunu VARSA korunur
  //   · referanssız düz CSV → korunamaz (eşleştirilecek anahtar yok). Misafir
  //     ADI bilerek tombstone anahtarı DEĞİL — adlar benzersiz değil, ad-bazlı
  //     bir kapı başka misafirlerin meşru kaydını da bloklardı.
  //
  // Boş tombstone kümesinde `loadErasureGuard` hiçbir şey hash'lemez ve
  // `EMPTY_GUARD` döner → bugün (host yüzeyi `GUEST_ERASURE_ENABLED` ile KAPALI,
  // yani hiç tombstone yok) bu blok ÖLÇÜLEBİLİR bir davranış değişikliği
  // getirmez; ileriye dönük bir kapıdır.
  const erasureGuard = await loadErasureGuard(session.organizationId);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowLabel = `Satır ${i + 2}`;

    // Validate required fields
    if (!row.guestName || row.guestName.length < 1) {
      errors.push(`${rowLabel}: Misafir adı eksik`);
      skipped++;
      continue;
    }
    if (!row.arrivalDate || isNaN(row.arrivalDate.getTime())) {
      errors.push(`${rowLabel}: Geçersiz giriş tarihi`);
      skipped++;
      continue;
    }
    if (!row.departureDate || isNaN(row.departureDate.getTime())) {
      errors.push(`${rowLabel}: Geçersiz çıkış tarihi`);
      skipped++;
      continue;
    }
    if (row.departureDate <= row.arrivalDate) {
      errors.push(`${rowLabel}: Çıkış tarihi girişten önce olamaz`);
      skipped++;
      continue;
    }

    // Skip duplicates: by sourceReference when present, else by the natural key
    // (guest + dates on this property) so a double-clicked / re-uploaded plain
    // CSV with no id column doesn't create full duplicate reservations + tasks.
    const dupe = row.sourceReference
      ? await prisma.reservation.findFirst({
          where: { propertyId, sourceReference: row.sourceReference },
          select: { id: true },
        })
      : await prisma.reservation.findFirst({
          where: {
            propertyId,
            guestName: row.guestName.slice(0, 200),
            arrivalDate: row.arrivalDate,
            departureDate: row.departureDate,
          },
          select: { id: true },
        });
    if (dupe) {
      skipped++;
      continue;
    }

    // Ucuz ÖN kapı — yalnız bir OPTİMİZASYON (yazma yetkisi DEĞİL). Yetkili
    // kontrol aşağıda, kilidin İÇİNDE taze okunan guard'la yapılır.
    if (!erasureGuard.isEmpty && erasureGuard.blocksSourceReference(row.sourceReference)) {
      skipped++;
      continue;
    }

    const data = {
      propertyId,
      // Clamp to the same caps the manual path enforces (validators.ts) —
      // the import path otherwise wrote unbounded CSV fields straight to DB.
      guestName: row.guestName.slice(0, 200),
      arrivalDate: row.arrivalDate,
      departureDate: row.departureDate,
      // ⚠️ Elle giriş yolu `z.enum(RESERVATION_CHANNEL.values)` ile 5 değere
      // kapalı (validators.ts); içe aktarma o kapalı seti atlıyordu ve bu alan
      // kardeşlerinin aksine KELEPÇESİZDİ (20.000 karakterlik hücre ham yazılıyordu).
      channel: (row.channel ?? "other").slice(0, 40),
      status: "confirmed",
      sourceReference: row.sourceReference ? row.sourceReference.slice(0, 200) : null,
      notes: row.notes ? row.notes.slice(0, 5000) : null,
      ...(typeof row.totalAmount === "number" && !isNaN(row.totalAmount)
        ? {
            totalAmount: Math.min(row.totalAmount, 100_000_000),
            totalAmountDec: toAmountDec(Math.min(row.totalAmount, 100_000_000)),
          }
        : {}),
      currency: (row.currency ?? "EUR").slice(0, 8),
    };

    try {
      // WRITE-TX (RACE MODEL, erasure.ts): satır yazımı org-kapsamlı silme
      // advisory kilidi altında, guard TAZE okunarak yapılır → ya bu commit
      // önce olur (silme yürütücüsü sonra koşar ve yazdığımızı maskeler) ya da
      // taze tombstone'ları görüp yazmayı reddederiz. Kardeş yollarla birebir
      // aynı desen (`import/sync.ts:190`, `hospitable-sync.ts:299`).
      //
      // ⚠️ Görev yan etkisi (`createReservationTasks`) commit'ten SONRA koşar —
      // kilit yalnız yazma boyunca tutulur.
      // ⚠️ CREATE'in dedupe-hit'i (P2002) satır transaction'ını iptal eder ve
      // DIŞ catch'te sınıflandırılır — atlama semantiği eskisiyle AYNI.
      const created = await prisma.$transaction(
        async (tx) => {
          await acquireErasureLock(tx, session.organizationId);
          const fresh = await loadErasureGuard(session.organizationId, tx);
          if (!fresh.isEmpty && fresh.blocksSourceReference(row.sourceReference)) return null;
          return await tx.reservation.create({ data });
        },
        // Kardeş KVKK yollarıyla birebir değerler (hospitable-sync.ts:306).
        { timeout: 60_000, maxWait: 15_000 },
      );
      if (!created) {
        skipped++;
        continue;
      }
      await createReservationTasks(created.id);
      imported++;
    } catch (err) {
      // A re-imported row with the same platform reference is a DEDUPE, not an
      // error (@@unique([propertyId, sourceReference]) is the arbiter now).
      if (isUniqueViolation(err, ["propertyId", "sourceReference"])) {
        skipped++;
        continue;
      }
      // Don't surface the raw DB/Prisma error text to the client — generic only.
      errors.push(`${rowLabel}: Kaydedilemedi (veritabanı hatası).`);
      skipped++;
    }
  }

  return jsonOk({ imported, skipped, errors });
});
