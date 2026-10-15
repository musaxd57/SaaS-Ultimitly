import { prisma } from "@/lib/db";
import { kbSchema, zodFieldErrors } from "@/lib/validators";
import { badRequest, jsonOk, propertyInOrg, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { limitsForOrg } from "@/lib/billing/plan-limits";
import { KB_ITEM_CAP } from "@/lib/ai/limits";
import { refreshPropertyMemoryBestEffort } from "@/modules/intelligence";
import { warmPropertyKbVectorsBestEffort } from "@/lib/ai/embeddings/kb-warm";
import { isUniqueViolation } from "@/lib/db-errors";
import { NextResponse } from "next/server";
import { KB_CREATE_CONFLICT_MESSAGE, KB_IDEMPOTENCY_CONFLICT, sameKbContent, withoutClientRequestId } from "@/lib/kb/request-id";

export const GET = withManage(async (session, req) => {
  const { searchParams } = new URL(req.url);
  const propertyId = searchParams.get("propertyId") ?? undefined;

  const items = await prisma.knowledgeBaseItem.findMany({
    where: {
      property: { organizationId: session.organizationId },
      ...(propertyId ? { propertyId } : {}),
    },
    include: { property: { select: { name: true } } },
    orderBy: [{ propertyId: "asc" }, { category: "asc" }],
  });
  return jsonOk(items.map(withoutClientRequestId));
});

export const POST = withManage(async (session, req) => {
  const data = await readJsonCappedOrNull(req);
  const parsed = kbSchema.safeParse(data);
  if (!parsed.success) return badRequest(zodFieldErrors(parsed.error));
  const d = parsed.data;

  if (!(await propertyInOrg(d.propertyId, session.organizationId))) {
    return badRequest({ propertyId: "Geçersiz mülk" });
  }

  // TEKRAR GÜVENLİĞİ (migration 67, kurucu 10-14 "İstek kimliği"): içe aktarımda bağlantı tam cevap anında koparsa istemci AYNI kimlikle
  // yeniden dener → ilk istek kalemi yazdıysa O kalem döner (ikinci kalem yok; plan sınırı yeniden sayılmaz — kalem zaten sayılıyor).
  // Arama mülk kapsamında (mülk yukarıda işletmeye bağlandı): başka işletmenin kimliği eşleşemez.
  const priorFor = (requestId: string) =>
    prisma.knowledgeBaseItem.findUnique({
      where: { propertyId_clientRequestId: { propertyId: d.propertyId, clientRequestId: requestId } },
    });
  // Var olan kalem dönerken eşitlemeler YİNE koşar (Haiku 10-14): ilk istek kalemi yazıp hafıza / vektör eşitlemesinden önce kesildiyse
  // yeniden deneme onları tamamlar. İkisi de tekrar güvenli (fırlatmaz, aynı sonucu yazar).
  const replay = async (prior: NonNullable<Awaited<ReturnType<typeof priorFor>>>) => {
    // Aynı kimlik, FARKLI içerik (kurucu 10-15): eski kalem sessizce dönmez — açık uyuşmazlık. Örnek: ilk deneme yazdı, cevap koptu, kalem
    // başka sekmede düzenlendi; eski sekmeden yeniden deneme artık "eklendi" sanmaz. İstemci kimliği bırakır (bilerek yeniden = yeni işlem).
    if (!sameKbContent(prior, d)) {
      // Kaydedilen kalem de döner (kurucu D1, 10-15: "mümkünse kaydedilmiş kalemi gösterip onu düzenleme seçeneği sun"). Kalem bu
      // işletmenin mülkünde (mülk yukarıda işletmeye bağlandı) ve bu kimlikle yazıldı — başka kiracıya ait olamaz.
      return NextResponse.json(
        {
          error: KB_CREATE_CONFLICT_MESSAGE,
          code: KB_IDEMPOTENCY_CONFLICT,
          existing: { id: prior.id, category: prior.category, title: prior.title, content: prior.content },
        },
        { status: 409 },
      );
    }
    await refreshPropertyMemoryBestEffort(session.organizationId, d.propertyId);
    warmPropertyKbVectorsBestEffort(d.propertyId);
    return jsonOk(withoutClientRequestId(prior), 200);
  };
  if (d.requestId) {
    const prior = await priorFor(d.requestId);
    if (prior) return replay(prior);
  }

  // PLAN SINIRLARI (billing/plan-limits.ts). İki ayrı kapı, ikisi de gerekli:
  //  · ADET — paketleri ayrıştıran ölçü (Başlangıç 15 / Pro 30 / İşletme 60).
  //  · KARAKTER — adet sınırının kaçış yolunu kapatır: yoksa host her şeyi TEK
  //    kayda doldurup sınırı anlamsız kılar ("giriş mesajına hepsini yazarım").
  const limits = await limitsForOrg(session.organizationId);
  if (d.content.length > limits.kbCharsPerItem) {
    return badRequest({
      content: `Tek bir bilgi kaydı en fazla ${limits.kbCharsPerItem.toLocaleString("tr-TR")} karakter olabilir. Uzun bilgileri birkaç kayda bölün — AI bir yanıtta en güncel ${KB_ITEM_CAP} kaydı okur.`,
    });
  }
  const activeCount = await prisma.knowledgeBaseItem.count({
    where: { propertyId: d.propertyId, isActive: true },
  });
  if (d.isActive && activeCount >= limits.kbItemsPerProperty) {
    // Eş zamanlı iki deneme: sayımı dolduran kalem bu kimliğin kalemi olabilir (öteki deneme az önce yazdı) — o zaman sınır hatası
    // değil, o kalem döner (Haiku 10-14).
    const prior = d.requestId ? await priorFor(d.requestId) : null;
    if (prior) return replay(prior);
    return badRequest({
      _: `Planınızın izin verdiği bilgi tabanı sınırına ulaştınız (daire başına ${limits.kbItemsPerProperty} kayıt). Kullanmadığınız kayıtları pasife alabilir veya planınızı yükseltebilirsiniz.`,
    });
  }

  let item;
  try {
    item = await prisma.knowledgeBaseItem.create({
      data: {
        propertyId: d.propertyId,
        category: d.category,
        title: d.title,
        content: d.content,
        language: d.language,
        isActive: d.isActive,
        // ONAY SÖZLEŞMESİ (A1): host bu metni KENDİ yazdı ve KENDİ kaydetti —
        // bundan daha açık bir onay yok, `approvedAt` de o anın GERÇEK zamanı.
        // Kolon varsayılanı da aynı; burada AÇIKÇA yazılıyor ki `approvedAt`
        // ile `reviewState` asla ayrışmasın ("approved ama zamanı yok" olmasın).
        source: "host_manual",
        reviewState: "approved",
        approvedAt: new Date(),
        clientRequestId: d.requestId ?? null,
      },
    });
  } catch (err) {
    // İki yeniden deneme AYNI ANDA geldiyse kaybeden, kazananın kalemini alır (yalnız BU benzersizlik ihlali; başkası fırlar).
    if (d.requestId && isUniqueViolation(err, ["propertyId", "clientRequestId"])) {
      const prior = await priorFor(d.requestId);
      if (prior) return replay(prior);
    }
    throw err;
  }
  // V1: KB = mülk hafızasının kaynağı → hafıza anında eşitlenir (fırlatmaz; KB kaydı başarılı kalır).
  await refreshPropertyMemoryBestEffort(session.organizationId, d.propertyId);
  // #189: anlamsal vektörler yazma anında (misafirin bir sonraki mesajı sözcüksele düşmesin; beklemez, fırlatmaz).
  warmPropertyKbVectorsBestEffort(d.propertyId);
  return jsonOk(withoutClientRequestId(item), 201);
});
