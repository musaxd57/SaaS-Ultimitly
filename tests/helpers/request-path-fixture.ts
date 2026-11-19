import { prisma, makeUser, PROPERTY_EXISTED_BEFORE } from "./db";
import { stayDay } from "./stay-dates";

// ---------------------------------------------------------------------------
// İSTEK YOLU FİKSTÜRÜ (optimizasyon turu 11-19). Ev sahibi sayfalarının (pano, gelen kutusu, konuşma, girişler, görevler, daire) her
// bacağını çalıştıran küçük ama dolu bir işletme: daire başına bugün giren / bugün çıkan / ileride gelen konaklama, cevapsız ve sorunlu
// konuşma, ev sahibine bırakılmış hassas istek, yaklaşan söz, devir temizliği, bağsız bakım, bilgi tabanı. İlk dairenin takvim beslemesi
// bozuk. Kimlikler `idPrefix` ile KARARLI (iki koşunun çıktısı birebir kıyaslanabilsin); tarihler `now`a göre (zaman bombası yok).
// Kurgusal adlar ("Lale").
// ---------------------------------------------------------------------------

export interface RequestPathFixture {
  orgId: string;
  userId: string;
  propertyIds: string[];
  /** Daire başına: bugün giren konaklamanın konuşması (cevapsız, 8 saat). */
  arrivalConversationIds: string[];
  /** Daire başına: bugün çıkan konaklamanın konuşması (sorunlu, hassas istek). */
  departureConversationIds: string[];
}

const HOUR = 3_600_000;

export async function seedRequestPathOrg(opts: { properties: number; now?: Date; idPrefix?: string }): Promise<RequestPathFixture> {
  const now = opts.now ?? new Date();
  const px = opts.idPrefix ?? "rp";
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR);
  const org = await prisma.organization.create({
    data: { id: `${px}-org`, name: "Lale İşletmesi", timezone: "Europe/Istanbul", aiSignature: "Lale ekibi", autoReplyHospitable: true },
  });
  const user = await makeUser({ data: { id: `${px}-user`, organizationId: org.id, email: `${px}-owner@test.local`, name: "Ayşe Yılmaz", passwordHash: "x" } });
  const propertyIds: string[] = [];
  const arrivalConversationIds: string[] = [];
  const departureConversationIds: string[] = [];
  for (let i = 0; i < opts.properties; i++) {
    const p = `${px}-p${i}`;
    await prisma.property.create({
      data: { id: p, organizationId: org.id, name: `Lale ${i + 1}`, checkInTime: "15:00", checkOutTime: "11:00", createdAt: PROPERTY_EXISTED_BEFORE },
    });
    propertyIds.push(p);
    const res = (key: string, arrival: number, departure: number) =>
      prisma.reservation.create({
        data: {
          id: `${p}-r${key}`,
          propertyId: p,
          guestName: `Misafir ${key.toUpperCase()}${i}`,
          arrivalDate: stayDay(arrival, now),
          departureDate: stayDay(departure, now),
          status: "confirmed",
          channel: "airbnb",
          sourceReference: `${p}-ref-${key}`,
          createdAt: at(24 * 20),
        },
      });
    await res("a", 0, 3);
    await res("b", -3, 0);
    await res("c", 6, 9);

    const cA = `${p}-ca`;
    await prisma.conversation.create({
      data: {
        id: cA,
        propertyId: p,
        reservationId: `${p}-ra`,
        channel: "airbnb",
        externalReservationId: `${p}-ref-a`,
        guestIdentifier: `Misafir A${i}`,
        status: "new",
        lastMessageAt: at(8),
      },
    });
    await prisma.message.create({
      data: { id: `${cA}-m1`, conversationId: cA, direction: "inbound", authorType: "guest", senderName: `Misafir A${i}`, body: "Merhaba, yarın geliyoruz.", createdAt: at(9) },
    });
    await prisma.message.create({
      data: { id: `${cA}-m2`, conversationId: cA, direction: "outbound", authorType: "host", senderName: "Ayşe", body: "Hoş geldiniz, bekliyoruz.", createdAt: at(8.5) },
    });
    await prisma.message.create({
      data: { id: `${cA}-m3`, conversationId: cA, direction: "inbound", authorType: "guest", senderName: `Misafir A${i}`, body: "Kablosuz ağ şifresi nedir?", createdAt: at(8) },
    });
    await prisma.guestCommitment.create({
      data: { id: `${cA}-g1`, organizationId: org.id, conversationId: cA, kind: "towels", dueAt: new Date(now.getTime() + HOUR), status: "open" },
    });
    arrivalConversationIds.push(cA);

    const cB = `${p}-cb`;
    await prisma.conversation.create({
      data: {
        id: cB,
        propertyId: p,
        reservationId: `${p}-rb`,
        channel: "airbnb",
        externalReservationId: `${p}-ref-b`,
        guestIdentifier: `Misafir B${i}`,
        status: "problem",
        lastMessageAt: at(3),
      },
    });
    await prisma.message.create({
      data: { id: `${cB}-m1`, conversationId: cB, direction: "inbound", authorType: "guest", senderName: `Misafir B${i}`, body: "Klima çalışmıyor, iade istiyorum.", createdAt: at(3) },
    });
    await prisma.conversationItem.create({
      data: {
        id: `${cB}-i1`,
        organizationId: org.id,
        conversationId: cB,
        messageId: `${cB}-m1`,
        kind: "cancellation_refund",
        sensitivity: "sensitive",
        sources: "lexical",
        status: "pending_host",
        createdAt: at(3),
      },
    });
    departureConversationIds.push(cB);

    await prisma.task.create({
      data: { id: `${p}-t1`, propertyId: p, reservationId: `${p}-rb`, type: "cleaning", title: "Çıkış temizliği", status: "pending", dueAt: stayDay(0, now) },
    });
    await prisma.task.create({
      data: { id: `${p}-t2`, propertyId: p, type: "maintenance", title: "Musluk", status: "pending", priority: "urgent", dueAt: stayDay(0, now) },
    });
    await prisma.knowledgeBaseItem.create({
      data: { id: `${p}-k1`, propertyId: p, category: "checkin", title: "Giriş", content: "Anahtar kutusu kapının yanında." },
    });
    await prisma.knowledgeBaseItem.create({
      data: { id: `${p}-k2`, propertyId: p, category: "wifi", title: "Kablosuz ağ", content: "Ağ: Lale, şifre: deniz123" },
    });
    if (i === 0) {
      await prisma.calendarSource.create({
        data: { id: `${p}-cal`, propertyId: p, label: "Booking", url: "https://example.invalid/feed.ics", lastStatus: "error", lastSyncedAt: at(5) },
      });
    }
  }
  return { orgId: org.id, userId: user.id, propertyIds, arrivalConversationIds, departureConversationIds };
}

/** Sayfa testlerinin taklit oturumu (rol veritabanıyla aynı: sahip). */
export function ownerSession(f: Pick<RequestPathFixture, "orgId" | "userId">) {
  return {
    userId: f.userId,
    organizationId: f.orgId,
    role: "owner",
    email: "owner@test.local",
    name: "Ayşe Yılmaz",
    sessionEpoch: 0,
  } as const;
}
