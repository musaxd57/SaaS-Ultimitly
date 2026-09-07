import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { toAmountDec } from "@/lib/money";
import { isUniqueViolation } from "@/lib/db-errors";
import { badRequest, jsonOk, readFormDataCapped, payloadTooLarge, BodyTooLargeError, tooManyRequests } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { parseIcs } from "@/lib/import/ics";
import { parseCsv, CsvParseError } from "@/lib/import/csv";
import { createReservationTasks, removeAutoTasksForCancelledReservation } from "@/lib/automation";
import { loadErasureGuard, acquireErasureLock } from "@/lib/erasure";

const IMPORT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * RFC 5545 `STATUS:CANCELLED` — the booking was killed upstream.
 *
 * 🚨 Bu kapı YOKTU (denetim 08-08). `parseIcs` alanı ÇIKARIYOR
 * (`IcsReservation.status`) ama rota `status: "confirmed"` yazan SABİT bir nesne
 * kuruyordu ve `ParsedRow` tipinde `status` alanı bile yoktu → TypeScript de
 * sessizdi (fazlalık-alan kontrolü nesne LİTERALİNE uygulanır, dizi ATAMASINA
 * değil, yani `rows = parseIcs(text)` uyarısız geçiyordu). Sonuç: AYNI DOSYA
 * nereden girdiğine göre İKİ FARKLI sonuç veriyordu — abonelik senkronu
 * (`import/sync.ts`) iptali yansıtırken elle yükleme iptal edilmiş konaklamayı
 * CANLI kaydediyor, daireyi dolu gösteriyor ve temizlik/giriş görevleri açıyordu.
 *
 * Karşılaştırma `parseIcs`'in ürettiği biçimden BAĞIMSIZ olsun diye burada da
 * trim+upper yapılıyor: ayrıştırıcı bugün büyük harfe çeviriyor, ama bu kapı
 * gelecekte durum üreten BAŞKA bir ayrıştırıcıya (örn. CSV'ye bir "status"
 * sütunu eklenirse) da hazır olmalı.
 */
function isCancelledRow(status: string | null | undefined): boolean {
  return (status ?? "").trim().toUpperCase() === "CANCELLED";
}

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
    /** VEVENT STATUS (RFC 5545), uppercased by the parser. `parseCsv` has no
     *  status column today, so CSV rows leave this undefined = live. */
    status?: string | null;
  };

  let rows: ParsedRow[] = [];
  if (isIcs) {
    // 🚨 KANAL EZİLMİYOR (denetim 08-07 (6)). Burada bir dönem `channel: "other"`
    // yazılıyordu — muhtemelen rozet ham "ics" göstermesin diye. Bedeli ağırdı:
    // yaşam-döngüsü gönderimleri `channel: { notIn: ["ics","manual"] }` ile
    // filtreliyor ("only Hospitable-messageable bookings — never iCal/manual"),
    // yani ELLE YÜKLENEN bir .ics satırı o kapıyı GEÇİYOR ve var olmayan bir
    // Hospitable konuşmasına karşılama/giriş mesajı denemesi başlatıyordu.
    // Rozet sorunu ETİKET HARİTASINA "ics" eklenerek çözüldü (`constants.ts`),
    // kanal değerini bükerek değil.
    // ⚠️ DÜZELTME (08-08): bu yorum bir dönem "aynı içerik abonelik
    // senkronundan gelince `ics` yazılıyordu" diyordu — YANLIŞTI. Abonelik yolu
    // kanalı `channelFromLabel(source.label)` ile yazar ve o fonksiyon ASLA
    // "ics" döndürmez ("Airbnb" etiketli besleme → `channel:"airbnb"`). Yani
    // abonelik satırları o kapıdan GEÇİYORDU; gerçek koruma `calendarSourceId`
    // ile ayrıca eklendi (`automation.ts`). "ics" kanalı bu ROTAYA özgü kalır ve
    // tam da bu yüzden elle yüklenen satırı benzersiz biçimde tanımlar (↓iptal).
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
  let cancelled = 0;
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

    // Ucuz ÖN kapı — yalnız bir OPTİMİZASYON (yazma yetkisi DEĞİL). Yetkili
    // kontrol aşağıda, kilidin İÇİNDE taze okunan guard'la yapılır.
    //
    // ⚠️ KONUM: dupe aramasının ÜSTÜNDE ve HER İKİ dalın (iptal + yeni kayıt)
    // ÖNÜNDE duruyor — kardeş yol da guard'ı en başta kontrol edip `"erased"`
    // dönüyor (`import/sync.ts`). Böylece iptal yazımı da silme kapısının AYNI
    // TARAFINDA kalır; kapıyı iptal dalından sonra koymak, tombstone'lu bir
    // referansın satırına yine de yazmak demek olurdu.
    const sourceReference = row.sourceReference ?? null;
    if (!erasureGuard.isEmpty && erasureGuard.blocksSourceReference(sourceReference)) {
      skipped++;
      continue;
    }

    // ── STATUS:CANCELLED — iptal edilmiş satır ASLA canlı yazılmaz ──────────
    //
    // Abonelik yolunun semantiği birebir taklit ediliyor (`import/sync.ts`):
    //   · yerel satır YOKSA        → atla (iptal kaydı UYDURULMAZ, create YOK)
    //   · yerel satır VARSA        → `status:"cancelled"` + oto görevleri sil
    //   · zaten iptalliyse         → dokunma (idempotent)
    //
    // ⚠️ TEK YÖN, BİLİNÇLİ: aboneliğin "canlı görünüyorsa yeniden onayla" dalı
    // (`sync.ts`, `existing.status === "cancelled"` → `confirmed`) buraya
    // TAŞINMADI. Gerekçe: iptal POZİTİF KANITTIR (dosyada açıkça yazar), geri
    // açma ise NEGATİF kanıta dayanırdı ("bu satırda iptal işareti yok") ve elle
    // yüklenen dosya ESKİ olabilir — sürekli yoklanan bir feed'in aksine. Aynı
    // muhakeme feed-disappearance reconcile'ının varsayılan KAPALI olmasının da
    // gerekçesi. Yanlışlıkla iptal edilen kayıt üründen geri açılabilir
    // (`PATCH /api/reservations/[id]` → `status`).
    if (isCancelledRow(row.status)) {
      // Eşleştirme anahtarı yoksa yapılacak bir şey de yok. Kardeş yol da
      // `existing`i YALNIZ `sourceReference` varken arıyor. Doğal anahtar
      // (misafir+tarih) yedeği burada BİLEREK kullanılmıyor: yalnızca adı ve
      // tarihleri çakışan, elle girilmiş bir kaydı sessizce öldürebilirdi.
      if (!sourceReference) {
        skipped++;
        continue;
      }

      const existing = await prisma.reservation.findFirst({
        where: { propertyId, sourceReference },
        select: { id: true, status: true, calendarSourceId: true },
      });

      // KAYNAK SAHİPLİĞİ: `calendarSourceId != null` = satır bir takvim
      // ABONELİĞİNE ait. Deponun kuralı "STATUS:CANCELLED yalnız KENDİ source
      // satırını iptal eder" (`import/sync.ts`) ve elle yükleme o kaynak
      // DEĞİLDİR → dokunmuyoruz. Kayıp yok: aynı içerik feed'den geldiğinde
      // aboneliğin kendi geçişi satırı zaten iptal eder; kazanç, eski bir elle
      // dosyanın canlı bir aboneliğin satırını deviremiyor olması.
      if (!existing || existing.status === "cancelled" || existing.calendarSourceId !== null) {
        skipped++;
        continue;
      }

      try {
        // Kardeş yollarla AYNI yazma-TX deseni: org-kapsamlı silme advisory
        // kilidi + TAZE guard okuması. Ön kapı yalnız optimizasyondu.
        const cancelledId = await prisma.$transaction(
          async (tx) => {
            await acquireErasureLock(tx, session.organizationId);
            const fresh = await loadErasureGuard(session.organizationId, tx);
            if (!fresh.isEmpty && fresh.blocksSourceReference(sourceReference)) return null;
            // Sahiplik ve "zaten iptalli mi" WHERE'in İÇİNDE tekrar sınanıyor →
            // okuma ile yazma arasında araya giren bir senkron bizi yanıltamaz
            // (kardeş yolun `updateMany` ile atomik sahiplik kontrolü aynısı).
            // 🚨 `channel: "ics"` DE ŞART (denetim 08-08). `calendarSourceId: null`
            // TEK BAŞINA "bunu daha önce ben yükledim" DEMEK DEĞİLDİR — o küme
            // Hospitable'dan gelen satırları ve elle girilen rezervasyonları DA
            // kapsıyor. Kardeş yol (abonelik senkronu) tam tersini yapıyor:
            // CANCELLED bir olayın SAHİPSİZ satıra dokunmasına hiç izin vermiyor
            // ("legacy" araması `row.status !== "CANCELLED"` koşullu). Buradaki
            // kural onun aynası olmalıydı, olmamıştı: UID'si bir Hospitable
            // `sourceReference`'ıyla çakışan bayat bir .ics, CANLI bir
            // rezervasyonu iptale çevirip `origin:"system"` görevlerini
            // SİLEBİLİRDİ (durum PATCH ile geri alınır, görevler alınmaz).
            // "ics" bu rotanın YAZDIĞI tek kanaldır ve `channelFromLabel` onu
            // asla üretmez → elle yüklenen satırı benzersiz tanımlar.
            const res = await tx.reservation.updateMany({
              where: {
                id: existing.id,
                calendarSourceId: null,
                channel: "ics",
                status: { not: "cancelled" },
              },
              data: { status: "cancelled" },
            });
            return res.count === 1 ? existing.id : null;
          },
          // Kardeş KVKK yollarıyla birebir değerler.
          { timeout: 60_000, maxWait: 15_000 },
        );
        if (!cancelledId) {
          skipped++;
          continue;
        }
        // Commit SONRASI yan etki — kardeş yolun `cancelled` dalıyla aynı:
        // iptal edilmiş konaklamanın yaşam-döngüsü görevleri (yalnız
        // origin:"system" olanlar) düşer, host'un kendi görevleri kalır.
        await removeAutoTasksForCancelledReservation(cancelledId);
        cancelled++;
      } catch {
        errors.push(`${rowLabel}: Kaydedilemedi (veritabanı hatası).`);
        skipped++;
      }
      continue;
    }

    // Skip duplicates: by sourceReference when present, else by the natural key
    // (guest + dates on this property) so a double-clicked / re-uploaded plain
    // CSV with no id column doesn't create full duplicate reservations + tasks.
    const dupe = sourceReference
      ? await prisma.reservation.findFirst({
          where: { propertyId, sourceReference },
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

    const data = {
      propertyId,
      // Clamp to the same caps the manual path enforces (validators.ts) —
      // the import path otherwise wrote unbounded CSV fields straight to DB.
      guestName: row.guestName.slice(0, 200),
      arrivalDate: row.arrivalDate,
      departureDate: row.departureDate,
      // 🚨 CSV'DEKİ KANAL SÜTUNU KULLANILMAZ (denetim 08-08, ÖLÇÜLDÜ).
      // Bu alan yalnız bir ROZET değil, yaşam-döngüsü gönderiminin YÖNLENDİRME
      // KAPISIDIR: altı sorgu da `channel notIn ["ics","manual"]` ile filtreliyor.
      // Eskiden buraya CSV hücresi ham geçiyordu (`row.channel ?? "other"`), yani
      // dosyaya `channel: airbnb` yazan bir satır ALTI KAPIYI DA geçiyordu —
      // `status:"confirmed"` burada yazılıyor, `sourceReference` CSV'den geliyor,
      // `calendarSourceId` hiç set edilmiyor. Sonuç: `sendOnChannel` CSV'deki
      // referansı Hospitable rezervasyon id'si sanıp POST ediyor → 4xx'te sonsuz
      // yeniden deneme + her koşuda alarm, 5xx'te hayalet konaklamaya kalıcı damga.
      // Bugün aynı delik `.ics` yüklemesinde (parser `channel:"ics"` sabitliyor) ve
      // abonelik senkronunda (`calendarSourceId`) kapatıldı; CSV bacağında
      // İKİ İŞARETÇİ DE yoktu.
      // ⚠️ BEDELİ BİLİNÇLİ: rozet artık OTA adını değil "Manuel" gösteriyor.
      // Kanal alanı bir MEKANİZMA işaretçisi olarak kullanılıyor (`.ics` emsalinin
      // aynısı) ve elle yüklenen satır tanım gereği Hospitable'da YOKTUR. OTA adını
      // ayrıca saklamak ayrı bir kolon = migration; `docs/ACIK-ISLER-2026-08-08.md`.
      // ⚠️ Yan kazanç: `row.channel` artık hiç kullanılmıyor, yani 40 karaktere
      // kırpılan ama kapalı sete HİÇ sınanmayan serbest metin de ortadan kalktı.
      // `.ics` → parser'ın sabitlediği "ics"; `.csv` → "manual". İkisi de
      // MEKANİZMA işaretçisi ve ikisi de yaşam-döngüsü kapısının dışında.
      channel: isIcs ? "ics" : "manual",
      status: "confirmed",
      ingestedAt: new Date(), // V0.4 provenance: İLK ALINMA, dosya bir ingress'tir (connectionId yok)
      sourceReference: sourceReference ? sourceReference.slice(0, 200) : null,
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
          if (!fresh.isEmpty && fresh.blocksSourceReference(sourceReference)) return null;
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

  // `cancelled` EKLENDİ (additive): iptal edilen satırları `skipped` içine
  // saymak, host'a "hiçbir şey olmadı" demek olurdu — oysa kayıt durum
  // değiştirdi ve görevleri silindi. Kardeş `SyncResult` bunu `updated` diye
  // sayıyor; bu rota BAŞKA hiçbir güncelleme yapmadığı için ayrı ve daha dürüst
  // bir ad tercih edildi.
  return jsonOk({ imported, cancelled, skipped, errors });
});
