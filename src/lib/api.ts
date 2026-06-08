import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "@/lib/auth";
import { prisma } from "@/lib/db";

export type { SessionPayload };

/** Returns the current session or null (for route handlers). */
export async function requireSession(): Promise<SessionPayload | null> {
  return getSession();
}

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function unauthorized() {
  return NextResponse.json({ error: "Yetkisiz erişim" }, { status: 401 });
}

export function badRequest(fields: Record<string, string>) {
  return NextResponse.json({ error: "Doğrulama hatası", fields }, { status: 400 });
}

export function notFound(message = "Kayıt bulunamadı") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function serverError(message = "Beklenmeyen bir hata oluştu") {
  return NextResponse.json({ error: message }, { status: 500 });
}

export function tooManyRequests(retryAfter: number, message = "Çok fazla istek. Lütfen biraz bekleyin.") {
  return NextResponse.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfter)) } },
  );
}

/** Verify a property belongs to the org (multi-tenant isolation). */
export async function propertyInOrg(propertyId: string, organizationId: string) {
  const property = await prisma.property.findFirst({
    where: { id: propertyId, organizationId },
    select: { id: true },
  });
  return Boolean(property);
}
