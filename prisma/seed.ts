import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

function daysFromNow(days: number, hour = 12, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function hoursFromNow(hours: number): Date {
  const d = new Date();
  d.setHours(d.getHours() + hours, 0, 0, 0);
  return d;
}

async function main() {
  console.log("🌱 Seeding GuestOps AI...");

  // SAFETY: everything below wipes the ENTIRE database before writing demo data.
  // Refuse to run against production — a stray `db:seed` / `db:reset` / `prisma
  // migrate reset` (which auto-runs this hook) pointed at the live DATABASE_URL
  // would destroy all customer data, violating the cardinal "don't break the
  // working product" rule. ALLOW_PROD_SEED=1 is the deliberate override.
  // NODE_ENV alone is NOT enough: a stray run with NODE_ENV unset/"development"
  // but DATABASE_URL pointed at the live DB would still wipe it. Refuse unless the
  // target host is a LOCAL database. ALLOW_PROD_SEED=1 is the deliberate override.
  let localDb = false;
  try {
    const h = new URL(process.env.DATABASE_URL ?? "").hostname;
    localDb = h === "localhost" || h === "127.0.0.1" || h === "::1";
  } catch {
    localDb = false; // unparseable / empty → treat as non-local (refuse)
  }
  if ((process.env.NODE_ENV === "production" || !localDb) && process.env.ALLOW_PROD_SEED !== "1") {
    throw new Error(
      "Refusing to seed/wipe: DATABASE_URL is not a local database (set ALLOW_PROD_SEED=1 to override).",
    );
  }

  // Clean slate (dependency order). Safe for local/dev reseeding.
  await prisma.taskUpdate.deleteMany();
  await prisma.task.deleteMany();
  await prisma.message.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.knowledgeBaseItem.deleteMany();
  await prisma.automationRule.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.property.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  const org = await prisma.organization.create({
    data: {
      name: "Bosphorus Stays",
      plan: "pro",
      timezone: "Europe/Istanbul",
      language: "tr",
    },
  });

  const passwordHash = await bcrypt.hash("demo1234", 10);
  const owner = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Demo Sahibi",
      email: "demo@guestops.ai",
      passwordHash,
      role: "owner",
    },
  });
  const staff = await prisma.user.create({
    data: {
      organizationId: org.id,
      name: "Ayşe Temizlik",
      email: "ayse@guestops.ai",
      passwordHash,
      role: "staff",
    },
  });

  const p1 = await prisma.property.create({
    data: {
      organizationId: org.id,
      name: "Galata Loft 1+1",
      address: "Bereketzade Mah. Galata",
      city: "İstanbul",
      country: "Türkiye",
      checkInTime: "15:00",
      checkOutTime: "11:00",
      cleaningBufferMinutes: 180,
      notes: "Tarihi binada, asansör yok. 3. kat.",
    },
  });
  const p2 = await prisma.property.create({
    data: {
      organizationId: org.id,
      name: "Kadıköy Deniz Manzaralı 2+1",
      address: "Caferağa Mah. Moda",
      city: "İstanbul",
      country: "Türkiye",
      checkInTime: "16:00",
      checkOutTime: "11:00",
      cleaningBufferMinutes: 120,
      notes: "Deniz manzaralı, klimalı.",
    },
  });

  // Knowledge base ----------------------------------------------------------
  await prisma.knowledgeBaseItem.createMany({
    data: [
      {
        propertyId: p1.id,
        category: "checkin",
        title: "Giriş Talimatı",
        content:
          "Bina girişindeki anahtar kutusu kodu 4821'dir. Daire 3. kattadır, kapı numarası 7.",
      },
      {
        propertyId: p1.id,
        category: "wifi",
        title: "Wi-Fi",
        content: "Ağ adı: GalataLoft | Şifre: misafir2024",
      },
      {
        propertyId: p1.id,
        category: "parking",
        title: "Otopark",
        content:
          "Binada özel otopark yoktur. En yakın otopark 200m mesafede Şişhane Katlı Otopark'tır.",
      },
      {
        propertyId: p1.id,
        category: "rules",
        title: "Ev Kuralları",
        content: "Sigara içmek yasaktır. Saat 22:00 sonrası sessizlik kuralı geçerlidir.",
      },
      {
        propertyId: p1.id,
        category: "location",
        title: "Konum",
        content:
          "Galata Kulesi'ne 3 dk yürüme mesafesinde. Şişhane metro istasyonu 5 dk.",
      },
      {
        propertyId: p2.id,
        category: "checkin",
        title: "Giriş Talimatı",
        content: "Kapıcıdan anahtarı alabilirsiniz. Daire 5. katta, no 12.",
      },
      {
        propertyId: p2.id,
        category: "wifi",
        title: "Wi-Fi",
        content: "Ağ adı: ModaSea | Şifre: deniz1234",
      },
    ],
  });

  // Reservations ------------------------------------------------------------
  const resA = await prisma.reservation.create({
    data: {
      propertyId: p1.id,
      guestName: "John Smith",
      guestEmail: "john@example.com",
      guestPhone: "+44 7700 900123",
      arrivalDate: daysFromNow(0, 15),
      departureDate: daysFromNow(3, 11),
      channel: "airbnb",
      status: "confirmed",
      totalAmount: 420,
      currency: "EUR",
      sourceReference: "HMABCD1234",
    },
  });
  const resB = await prisma.reservation.create({
    data: {
      propertyId: p1.id,
      guestName: "Maria Garcia",
      guestEmail: "maria@example.com",
      arrivalDate: daysFromNow(-2, 15),
      departureDate: daysFromNow(0, 11),
      channel: "booking",
      status: "confirmed",
      totalAmount: 280,
      currency: "EUR",
      sourceReference: "BK-998877",
    },
  });
  await prisma.reservation.create({
    data: {
      propertyId: p2.id,
      guestName: "Ahmet Yılmaz",
      guestPhone: "+90 532 000 0000",
      arrivalDate: daysFromNow(5, 16),
      departureDate: daysFromNow(8, 11),
      channel: "direct",
      status: "pending",
      totalAmount: 6000,
      currency: "TRY",
    },
  });
  await prisma.reservation.create({
    data: {
      propertyId: p2.id,
      guestName: "Laura Bianchi",
      arrivalDate: daysFromNow(-10, 16),
      departureDate: daysFromNow(-7, 11),
      channel: "airbnb",
      status: "completed",
      totalAmount: 540,
      currency: "EUR",
    },
  });

  // Conversations + messages ------------------------------------------------
  const conv1 = await prisma.conversation.create({
    data: {
      propertyId: p1.id,
      reservationId: resA.id,
      channel: "airbnb",
      guestIdentifier: "John Smith",
      status: "new",
      priority: "standard",
      lastMessageAt: hoursFromNow(-1),
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conv1.id,
      direction: "inbound",
      senderName: "John Smith",
      body: "Hi! Is early check-in possible? Our flight lands at 11am.",
      language: "en",
      createdAt: hoursFromNow(-1),
    },
  });

  const conv2 = await prisma.conversation.create({
    data: {
      propertyId: p1.id,
      reservationId: resB.id,
      channel: "whatsapp",
      guestIdentifier: "Maria Garcia",
      status: "answered",
      priority: "standard",
      lastMessageAt: hoursFromNow(-20),
    },
  });
  await prisma.message.createMany({
    data: [
      {
        conversationId: conv2.id,
        direction: "inbound",
        senderName: "Maria Garcia",
        body: "Merhaba, Wi-Fi şifresi nedir?",
        language: "tr",
        createdAt: hoursFromNow(-22),
      },
      {
        conversationId: conv2.id,
        direction: "outbound",
        senderName: "Demo Sahibi",
        body: "Merhaba Maria,\n\nWi-Fi bilgileri: Ağ adı: GalataLoft | Şifre: misafir2024\n\nİyi günler dileriz.",
        language: "tr",
        createdAt: hoursFromNow(-20),
      },
    ],
  });

  const conv3 = await prisma.conversation.create({
    data: {
      propertyId: p2.id,
      channel: "whatsapp",
      guestIdentifier: "Laura Bianchi",
      status: "problem",
      priority: "urgent",
      lastMessageAt: hoursFromNow(-3),
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conv3.id,
      direction: "inbound",
      senderName: "Laura Bianchi",
      body: "The air conditioning is not working and it's very hot. This is a problem!",
      language: "en",
      aiIntent: "complaint",
      aiConfidence: 0.7,
      createdAt: hoursFromNow(-3),
    },
  });

  // Tasks -------------------------------------------------------------------
  await prisma.task.create({
    data: {
      propertyId: p1.id,
      reservationId: resB.id,
      type: "cleaning",
      title: "Galata Loft - çıkış temizliği",
      description: "Maria çıkışı sonrası tam temizlik. Çarşaf ve havlu değişimi.",
      assignedToId: staff.id,
      dueAt: hoursFromNow(3),
      status: "todo",
      priority: "urgent",
      checklistJson: JSON.stringify([
        { label: "Yatak takımlarını değiştir", done: false },
        { label: "Banyo temizliği", done: false },
        { label: "Mutfak kontrolü", done: false },
        { label: "Çöpleri çıkar", done: false },
      ]),
    },
  });
  await prisma.task.create({
    data: {
      propertyId: p1.id,
      reservationId: resB.id,
      type: "checkout_review",
      title: "Çıkış sonrası kontrol - Galata Loft",
      description: "Eksik/hasarlı eşya kontrolü ve fotoğraf.",
      dueAt: hoursFromNow(4),
      status: "todo",
      priority: "standard",
    },
  });
  await prisma.task.create({
    data: {
      propertyId: p1.id,
      reservationId: resA.id,
      type: "checkin_prep",
      title: "John Smith girişi için hazırlık",
      description: "Hoş geldin seti, anahtar kutusu kontrolü.",
      assignedToId: staff.id,
      dueAt: daysFromNow(0, 13),
      status: "in_progress",
      priority: "standard",
    },
  });
  await prisma.task.create({
    data: {
      propertyId: p2.id,
      type: "maintenance",
      title: "Klima arızası - Kadıköy",
      description: "Misafir klimanın çalışmadığını bildirdi. Teknisyen çağrılmalı.",
      dueAt: hoursFromNow(2),
      status: "todo",
      priority: "urgent",
    },
  });
  await prisma.task.create({
    data: {
      propertyId: p2.id,
      type: "laundry",
      title: "Çamaşır teslim - Kadıköy",
      description: "Temiz çarşaf/havlu teslimi.",
      assignedToId: staff.id,
      status: "done",
      priority: "low",
    },
  });

  // Automation rules (fixed if/then, stored only for MVP) -------------------
  await prisma.automationRule.createMany({
    data: [
      {
        organizationId: org.id,
        name: "Check-out sonrası temizlik görevi",
        triggerType: "checkout_completed",
        actionJson: JSON.stringify({
          createTask: { type: "cleaning", priority: "urgent" },
          notify: "team_lead",
        }),
        isEnabled: true,
      },
      {
        organizationId: org.id,
        name: "Şikayet eskalasyonu",
        triggerType: "complaint_detected",
        actionJson: JSON.stringify({
          setPriority: "urgent",
          setStatus: "problem",
          notify: "manager",
          createTask: { type: "maintenance" },
        }),
        isEnabled: true,
      },
      {
        organizationId: org.id,
        name: "Check-in mesajı (24 saat önce)",
        triggerType: "reservation_created",
        conditionJson: JSON.stringify({ hoursBeforeArrival: 24 }),
        actionJson: JSON.stringify({ sendMessage: "checkin_instructions", requireApproval: true }),
        isEnabled: true,
      },
    ],
  });

  // Plans (Faz 2) — idempotent upsert; mirrors src/lib/billing/plans.ts.
  const seedPlans: {
    code: string; name: string; propertyLimit: number | null;
    priceMinor: number; currency: string; interval: string; sortOrder: number;
  }[] = [
    // Prices MUST match src/lib/billing/plans.ts (DEFAULT_PLANS). These were stale
    // (old ₺0/₺499/₺999 anchors) — corrected to the live reverse-trial pricing so
    // the DB Plan table never bills a wrong amount if checkout ever reads it.
    { code: "free", name: "Başlangıç", propertyLimit: 2, priceMinor: 44900, currency: "TRY", interval: "month", sortOrder: 0 },
    { code: "pro", name: "Pro", propertyLimit: 7, priceMinor: 89900, currency: "TRY", interval: "month", sortOrder: 1 },
    { code: "business", name: "İşletme", propertyLimit: null, priceMinor: 169900, currency: "TRY", interval: "month", sortOrder: 2 },
  ];
  for (const plan of seedPlans) {
    await prisma.plan.upsert({ where: { code: plan.code }, create: plan, update: plan });
  }

  console.log("✅ Seed complete.");
  console.log(`   Org: ${org.name}`);
  console.log(`   Login: ${owner.email} / demo1234`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
