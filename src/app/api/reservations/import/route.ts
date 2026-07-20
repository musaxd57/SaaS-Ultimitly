import { prisma } from "@/lib/db";
import { toAmountDec } from "@/lib/money";
import { isUniqueViolation } from "@/lib/db-errors";
import { badRequest, jsonOk, readFormDataCapped, payloadTooLarge, BodyTooLargeError } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { parseIcs } from "@/lib/import/ics";
import { parseCsv, CsvParseError } from "@/lib/import/csv";
import { createReservationTasks } from "@/lib/automation";

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
    rows = parseIcs(text).map((r) => ({
      ...r,
      channel: "other" as const,
    }));
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

    try {
      const created = await prisma.reservation.create({
        data: {
          propertyId,
          // Clamp to the same caps the manual path enforces (validators.ts) —
          // the import path otherwise wrote unbounded CSV fields straight to DB.
          guestName: row.guestName.slice(0, 200),
          arrivalDate: row.arrivalDate,
          departureDate: row.departureDate,
          channel: row.channel ?? "other",
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
        },
      });
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
