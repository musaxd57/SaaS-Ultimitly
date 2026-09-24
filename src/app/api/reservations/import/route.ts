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
import { recordIngestEvent } from "@/lib/ingest/events";
import { followReservationDates } from "@/lib/tasks/follow-reservation";
import { ANON_NAME } from "@/lib/data-retention";

const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
/** Önizleme yanıtında satır listesi tavanı (sayımlar TÜM satırlar üzerinden). */
const PREVIEW_ROW_CAP = 200;

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

function sameInstant(a: Date | null | undefined, b: Date | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.getTime() === b.getTime();
}

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

// ---------------------------------------------------------------------------
// SATIR SINIFLANDIRMASI — "Dosyadan içe aktar" (Codex, 2026-09-08).
//
// Önizleme ve gerçek aktarım AYNI sınıflandırmayı kullanır: host kaydetmeden
// önce hangi mülke, kaç satırın ekleneceğini / güncelleneceğini / iptal
// edileceğini / atlanacağını (ve NEDEN) görür. Sınıflandırma SALT OKUMADIR;
// yazma yetkisi aşağıdaki TX'lerin İÇİNDEKİ atomik WHERE koşullarındadır
// (sahiplik + durum okuma ile yazma arasında yeniden sınanır).
//
// Sahiplik kuralı (kardeş yolun aynası, `import/sync.ts`): bu rota YALNIZ
// kendi yazdığı satırlara dokunur — `calendarSourceId IS NULL` VE `channel =
// "ics"` (bu kanalı yalnız bu rota üretir; `channelFromLabel` asla "ics"
// döndürmez). Takvim bağlantısına ait satır (`calendarSourceId` dolu) ve
// Hospitable / elle girilmiş satır (başka kanal) "başka kaynak"tır → atlanır.
// Böylece "sonraki dosya önceki aktarımın güncellemesi mi, ayrı kaynak mı"
// sorusu satır başına AÇIKÇA cevaplanır.
//
// Yapılmayanlar (bilinçli, kardeş yolla aynı): dosyada BULUNMAYAN eski satır
// sırf eksik diye iptal EDİLMEZ (tek seferlik dosya eski olabilir); iptalli
// satır canlı görünen satırla GERİ AÇILMAZ (pozitif kanıt kuralı ↓).
// ---------------------------------------------------------------------------
type RowAction = "create" | "update" | "cancel" | "skip";
type SkipReason =
  | "invalid_guest"
  | "invalid_arrival"
  | "invalid_departure"
  | "invalid_range"
  | "erased"
  | "cancel_no_ref"
  | "cancel_no_match"
  | "cancel_already"
  | "owned_by_feed"
  | "owned_by_other"
  | "cancelled_stays"
  | "unchanged"
  | "duplicate";

interface Classified {
  line: number;
  rowLabel: string;
  row: ParsedRow;
  sourceReference: string | null;
  action: RowAction;
  reason: SkipReason | null;
  /** Hata metni (yalnız geçersiz satırlarda; host'a gösterilir). */
  error: string | null;
  existingId: string | null;
  /** update: KVKK-anonimleştirilmiş satırda ad/not YAZILMAZ (dirilme guard'ı). */
  scrubbed: boolean;
  changedFields: string[];
}

const EXISTING_SELECT = {
  id: true,
  status: true,
  calendarSourceId: true,
  channel: true,
  guestName: true,
  notes: true,
  arrivalDate: true,
  departureDate: true,
} as const;

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
  // `mode=preview` → HİÇBİR ŞEY YAZILMAZ; yalnız sınıflandırma + sayımlar döner.
  const preview = formData.get("mode") === "preview";

  if (!file) return badRequest({ file: "Dosya gerekli" });
  // Second line (for a missing/lying Content-Length): the per-file size cap, still
  // BEFORE file.text() buffers a second copy into a string.
  if (file.size > IMPORT_MAX_BYTES) return badRequest({ file: "Dosya çok büyük (en fazla 5 MB)." });
  if (!propertyId) return badRequest({ propertyId: "Mülk seçin" });

  // Verify the property belongs to this organization.
  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId: session.organizationId },
    select: { id: true, name: true },
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
  //
  // ÖNİZLEME AYRI KOVADA: yalnız okur (satır başına 1 findFirst), yazmaz; host
  // dosyayı düzeltip birkaç kez bakabilsin diye daha cömert ama yine sınırlı.
  // Önizleme AKTARIM bütçesini tüketmez (6 önizleme sonra aktarım hâlâ geçer).
  const limited = preview
    ? await rateLimit(`reservation-import-preview:${session.organizationId}`, 30, 60 * 60_000)
    : await rateLimit(`reservation-import:${session.organizationId}`, 5, 60 * 60_000);
  if (!limited.ok) {
    return tooManyRequests(
      limited.retryAfter,
      // Süreyi SÖYLE: genel metin "kısa bir süre" diyor ama buradaki pencere
      // bir SAAT — host boşuna tekrar tekrar denemesin.
      preview
        ? `Saatte en fazla 30 önizleme yapılabilir. Yaklaşık ${Math.ceil(limited.retryAfter / 60)} dakika sonra tekrar deneyin.`
        : `Saatte en fazla 5 içe aktarım yapılabilir. Yaklaşık ${Math.ceil(limited.retryAfter / 60)} dakika sonra tekrar deneyin.`,
    );
  }

  const text = await file.text();

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

  // ── SINIFLANDIRMA (salt okuma; önizleme ve aktarım için ortak) ─────────────
  const classified: Classified[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowLabel = `Satır ${i + 2}`;
    const sourceReference = row.sourceReference ?? null;
    const base: Classified = {
      line: i + 1,
      rowLabel,
      row,
      sourceReference,
      action: "skip",
      reason: null,
      error: null,
      existingId: null,
      scrubbed: false,
      changedFields: [],
    };
    const skip = (reason: SkipReason, error: string | null = null) => classified.push({ ...base, reason, error });

    // Validate required fields
    if (!row.guestName || row.guestName.length < 1) {
      skip("invalid_guest", `${rowLabel}: Misafir adı eksik`);
      continue;
    }
    if (!row.arrivalDate || isNaN(row.arrivalDate.getTime())) {
      skip("invalid_arrival", `${rowLabel}: Geçersiz giriş tarihi`);
      continue;
    }
    if (!row.departureDate || isNaN(row.departureDate.getTime())) {
      skip("invalid_departure", `${rowLabel}: Geçersiz çıkış tarihi`);
      continue;
    }
    if (row.departureDate <= row.arrivalDate) {
      skip("invalid_range", `${rowLabel}: Çıkış tarihi girişten önce olamaz`);
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
    if (!erasureGuard.isEmpty && erasureGuard.blocksSourceReference(sourceReference)) {
      skip("erased");
      continue;
    }

    const existing = sourceReference
      ? await prisma.reservation.findFirst({ where: { propertyId, sourceReference }, select: EXISTING_SELECT })
      : null;

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
        skip("cancel_no_ref");
        continue;
      }
      if (!existing) {
        skip("cancel_no_match");
        continue;
      }
      if (existing.status === "cancelled") {
        skip("cancel_already");
        continue;
      }
      // KAYNAK SAHİPLİĞİ: `calendarSourceId != null` = satır bir takvim
      // ABONELİĞİNE ait. Deponun kuralı "STATUS:CANCELLED yalnız KENDİ source
      // satırını iptal eder" (`import/sync.ts`) ve elle yükleme o kaynak
      // DEĞİLDİR → dokunmuyoruz. Kayıp yok: aynı içerik feed'den geldiğinde
      // aboneliğin kendi geçişi satırı zaten iptal eder; kazanç, eski bir elle
      // dosyanın canlı bir aboneliğin satırını deviremiyor olması.
      if (existing.calendarSourceId !== null) {
        skip("owned_by_feed");
        continue;
      }
      // 🚨 `channel: "ics"` DE ŞART (denetim 08-08). `calendarSourceId: null`
      // TEK BAŞINA "bunu daha önce ben yükledim" DEMEK DEĞİLDİR — o küme
      // Hospitable'dan gelen satırları ve elle girilen rezervasyonları DA
      // kapsıyor. UID'si bir Hospitable `sourceReference`'ıyla çakışan bayat bir
      // .ics, CANLI bir rezervasyonu iptale çevirip `origin:"system"` görevlerini
      // SİLEBİLİRDİ. "ics" bu rotanın YAZDIĞI tek kanaldır.
      if (existing.channel !== "ics") {
        skip("owned_by_other");
        continue;
      }
      classified.push({ ...base, action: "cancel", existingId: existing.id });
      continue;
    }

    // ── CANLI satır: mevcut kayıt varsa GÜNCELLEME mi, atlama mı? ────────────
    if (existing) {
      if (existing.calendarSourceId !== null) {
        skip("owned_by_feed");
        continue;
      }
      // Güncelleme yalnız .ics → .ics (bu rotanın kendi satırı). CSV bacağında
      // güncelleme semantiği YOK (kapsam: Codex 09-08, .ics); eski davranış = atla.
      if (!isIcs || existing.channel !== "ics") {
        skip(existing.channel === "manual" && !isIcs ? "duplicate" : "owned_by_other");
        continue;
      }
      if (existing.status === "cancelled") {
        skip("cancelled_stays");
        continue;
      }
      // KVKK resurrection guard: retention süpürgesi bu satırı anonimleştirdiyse
      // (guestName === ANON_NAME) dosyadan ad/not GERİ YAZILMAZ; tarihler (PII
      // değil) tazelenir. Kardeş yolla (`import/sync.ts`) birebir.
      const scrubbed = existing.guestName === ANON_NAME;
      const changedFields: string[] = [];
      if (!sameInstant(existing.arrivalDate, row.arrivalDate)) changedFields.push("arrivalDate");
      if (!sameInstant(existing.departureDate, row.departureDate)) changedFields.push("departureDate");
      if (!scrubbed) {
        if (existing.guestName !== row.guestName.slice(0, 200)) changedFields.push("guestName");
        if ((existing.notes ?? null) !== (row.notes ? row.notes.slice(0, 5000) : null)) changedFields.push("notes");
      }
      if (changedFields.length === 0) {
        skip("unchanged");
        continue;
      }
      classified.push({ ...base, action: "update", existingId: existing.id, scrubbed, changedFields });
      continue;
    }

    // Skip duplicates by the natural key (guest + dates on this property) when
    // there is no reference — so a double-clicked / re-uploaded plain CSV with
    // no id column doesn't create full duplicate reservations + tasks.
    if (!sourceReference) {
      const dupe = await prisma.reservation.findFirst({
        where: {
          propertyId,
          guestName: row.guestName.slice(0, 200),
          arrivalDate: row.arrivalDate,
          departureDate: row.departureDate,
        },
        select: { id: true },
      });
      if (dupe) {
        skip("duplicate");
        continue;
      }
    }
    classified.push({ ...base, action: "create" });
  }

  const counts = { create: 0, update: 0, cancel: 0, skipped: 0 };
  for (const c of classified) {
    if (c.action === "create") counts.create++;
    else if (c.action === "update") counts.update++;
    else if (c.action === "cancel") counts.cancel++;
    else counts.skipped++;
  }

  if (preview) {
    // Yazma YOK: rezervasyon, event, görev, kilit — hiçbiri. Yalnız plan.
    return jsonOk({
      preview: true,
      property: { id: property.id, name: property.name },
      counts,
      total: classified.length,
      rows: classified.slice(0, PREVIEW_ROW_CAP).map((c) => ({
        line: c.line,
        uid: c.sourceReference,
        guestName: c.row.guestName ? c.row.guestName.slice(0, 200) : null,
        arrival: c.row.arrivalDate && !isNaN(c.row.arrivalDate.getTime()) ? c.row.arrivalDate.toISOString().slice(0, 10) : null,
        departure:
          c.row.departureDate && !isNaN(c.row.departureDate.getTime()) ? c.row.departureDate.toISOString().slice(0, 10) : null,
        action: c.action,
        reason: c.reason,
        error: c.error,
      })),
    });
  }

  // ── AKTARIM ────────────────────────────────────────────────────────────────
  let imported = 0;
  let updated = 0;
  let cancelled = 0;
  let skipped = 0;
  const errors: string[] = [];
  const ingestCtx = { organizationId: session.organizationId, provider: "manual_file" as const, connectionId: null };

  for (const c of classified) {
    const { row, rowLabel, sourceReference } = c;

    if (c.action === "skip") {
      if (c.error) errors.push(c.error);
      skipped++;
      continue;
    }

    if (c.action === "cancel") {
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
            // 🚨 `channel: "ics"` DE ŞART (denetim 08-08) — ↑sınıflandırma gerekçesi.
            const res = await tx.reservation.updateMany({
              where: {
                id: c.existingId!,
                calendarSourceId: null,
                channel: "ics",
                status: { not: "cancelled" },
              },
              data: { status: "cancelled" },
            });
            if (res.count !== 1) return null;
            // V1: elle dosya bir Lixus-native giriştir → iptal event'i satırla aynı TX'te.
            await recordIngestEvent(tx, ingestCtx, "reservation", c.existingId!, "reservation.cancelled");
            return c.existingId!;
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

    if (c.action === "update") {
      try {
        const updatedId = await prisma.$transaction(
          async (tx) => {
            await acquireErasureLock(tx, session.organizationId);
            const fresh = await loadErasureGuard(session.organizationId, tx);
            if (!fresh.isEmpty && fresh.blocksSourceReference(sourceReference)) return null;
            // ATOMİK sahiplik: yalnız bu rotanın kendi CANLI satırı (`calendarSourceId`
            // NULL + `channel` "ics" + iptalli değil). Araya giren bir senkron/iptal
            // satırı değiştirdiyse count 0 → dokunmadan atla.
            // Eski tarihler TX İÇİNDE okunur (sınıflandırma TX dışında; araya giren aktarım görevi yanlış tarihten taşımasın).
            const prev = await tx.reservation.findUnique({
              where: { id: c.existingId! },
              select: { arrivalDate: true, departureDate: true },
            });
            const res = await tx.reservation.updateMany({
              where: { id: c.existingId!, calendarSourceId: null, channel: "ics", status: { not: "cancelled" } },
              data: {
                arrivalDate: row.arrivalDate,
                departureDate: row.departureDate,
                ...(c.scrubbed
                  ? {}
                  : {
                      guestName: row.guestName.slice(0, 200),
                      notes: row.notes ? row.notes.slice(0, 5000) : null,
                    }),
              },
            });
            if (res.count !== 1) return null;
            // Tarih değiştiyse açık yaşam döngüsü görevleri yeni tarihe (aynı TX; host'un taşıdığına dokunulmaz — dilim 4a).
            if (prev) await followReservationDates(tx, c.existingId!, prev, row);
            // V1: değişen alan ADLARI (değer yok) — tarih alanları date_change sinyalinin girdisi.
            await recordIngestEvent(tx, ingestCtx, "reservation", c.existingId!, "reservation.updated", c.changedFields);
            return c.existingId!;
          },
          { timeout: 60_000, maxWait: 15_000 },
        );
        if (!updatedId) {
          skipped++;
          continue;
        }
        // Kardeş yolla aynı: görev backfill'i (idempotent).
        await createReservationTasks(updatedId);
        updated++;
      } catch {
        errors.push(`${rowLabel}: Kaydedilemedi (veritabanı hatası).`);
        skipped++;
      }
      continue;
    }

    // action === "create"
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
      // aynı desen (`import/sync.ts`, `hospitable-sync.ts`).
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
          const created = await tx.reservation.create({ data });
          // V1: yeni satır → `reservation.created` aynı TX'te (dedupe-hit'te TX iptal → event de yok).
          await recordIngestEvent(tx, ingestCtx, "reservation", created.id, "reservation.created");
          return created;
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
  // sayıyor; `updated` burada da AYRI ve additive: aynı UID'li önceki dosya
  // aktarımının tarih/ad güncellemesi (Codex 09-08), iptalden farklı.
  return jsonOk({ imported, updated, cancelled, skipped, errors });
});
