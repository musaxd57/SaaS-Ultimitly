import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized, badRequest, jsonOk, serverError } from "@/lib/api";
import { parseIcs } from "@/lib/import/ics";
import { parseCsv } from "@/lib/import/csv";
import { createReservationTasks } from "@/lib/automation";

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return unauthorized();

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const propertyId = formData.get("propertyId") as string | null;

    if (!file) return badRequest({ file: "Dosya gerekli" });
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
      rows = parseCsv(text);
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

      // Skip duplicates by sourceReference (if provided)
      if (row.sourceReference) {
        const existing = await prisma.reservation.findFirst({
          where: { propertyId, sourceReference: row.sourceReference },
          select: { id: true },
        });
        if (existing) {
          skipped++;
          continue;
        }
      }

      try {
        const created = await prisma.reservation.create({
          data: {
            propertyId,
            guestName: row.guestName,
            arrivalDate: row.arrivalDate,
            departureDate: row.departureDate,
            channel: row.channel ?? "other",
            status: "confirmed",
            sourceReference: row.sourceReference ?? null,
            notes: row.notes ?? null,
            ...(typeof row.totalAmount === "number" && !isNaN(row.totalAmount)
              ? { totalAmount: row.totalAmount }
              : {}),
            currency: row.currency ?? "EUR",
          },
        });
        await createReservationTasks(created.id);
        imported++;
      } catch (err) {
        errors.push(`${rowLabel}: Veritabanı hatası — ${String(err).slice(0, 80)}`);
        skipped++;
      }
    }

    return jsonOk({ imported, skipped, errors });
  } catch {
    return serverError();
  }
}
