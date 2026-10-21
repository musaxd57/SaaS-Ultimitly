import { prisma } from "@/lib/db";
import { badRequest, jsonOk, notFound, readJsonCappedOrNull } from "@/lib/api";
import { withManage } from "@/lib/route-guard";
import { limitsForOrg } from "@/lib/billing/plan-limits";
import { refreshPropertyMemoryBestEffort } from "@/modules/intelligence";
import { warmPropertyKbVectorsBestEffort } from "@/lib/ai/embeddings/kb-warm";
import { isUniqueViolation } from "@/lib/db-errors";
import { KB_REQUEST_ID_RE } from "@/lib/validators";
import { NextResponse } from "next/server";
import { KB_COPY_CONFLICT_MESSAGE, KB_IDEMPOTENCY_CONFLICT, sameKbContent } from "@/lib/kb/request-id";
import { kbContentFingerprint } from "@/lib/kb/copy-fingerprint";

/** Kopyalama işlem kaydının saklama süresi (tekrar penceresi bundan uzun olamaz). */
const KB_COPY_OPERATION_TTL_MS = 30 * 86_400_000;

// Copy a knowledge-base entry to one or more OTHER apartments. Lets the host
// fill one apartment fully, then clone its info across the rest and only tweak
// the apartment-specific bits (door code, wifi, address line).
export const POST = withManage<{ id: string }>(async (session, req, { params }) => {
  const { id } = await params;

  // The source entry must belong to the caller's organization.
  const source = await prisma.knowledgeBaseItem.findFirst({
    where: { id, property: { organizationId: session.organizationId } },
    select: {
      propertyId: true,
      category: true,
      title: true,
      content: true,
      language: true,
      isActive: true,
      // Onay soyu (A1) kopyaya AYNEN geçer — aşağıdaki `create`'e bakın.
      source: true,
      reviewState: true,
      approvedAt: true,
    },
  });
  if (!source) return notFound();

  const body = await readJsonCappedOrNull(req);
  const requested: unknown = body?.targetPropertyIds;
  const ids = Array.isArray(requested)
    ? requested.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) {
    return badRequest({ targetPropertyIds: "En az bir hedef daire seçin." });
  }
  // TEKRAR GÜVENLİĞİ (idempotency denetimi 10-15, P1; migration YOK — 67'nin (mülk, kimlik) benzersiz dizini): çift tık / bağlantı cevap
  // anında koptu → istemci AYNI kimlikle yeniden dener; her hedef dairede kalem `copy:<kaynak>:<kimlik>` anahtarıyla bir kez yazılır.
  // Kaynak kimliği anahtarda: aynı istek kimliği başka bir kaynağın kopyasını "zaten var" saydırmaz. Kimlik biçimi (`KB_REQUEST_ID_RE`)
  // `:` içermez → ekleme rotasının anahtarı kopya anahtarıyla çakışamaz. Kimliksiz eski istemci eski davranışta kalır.
  const rawRequestId: unknown = body?.requestId;
  if (rawRequestId !== undefined && (typeof rawRequestId !== "string" || !KB_REQUEST_ID_RE.test(rawRequestId))) {
    return badRequest({ requestId: "Geçersiz istek kimliği" });
  }
  const copyKey = typeof rawRequestId === "string" ? `copy:${id}:${rawRequestId}` : null;
  const alreadyCopied = async (propertyId: string) =>
    copyKey != null &&
    (await prisma.knowledgeBaseItem.findUnique({
      where: { propertyId_clientRequestId: { propertyId, clientRequestId: copyKey } },
      select: { id: true },
    })) != null;

  // Keep only valid targets in this org, and never copy onto the source itself.
  const targets = await prisma.property.findMany({
    where: {
      organizationId: session.organizationId,
      id: { in: ids },
      NOT: { id: source.propertyId },
    },
    select: { id: true, name: true },
  });

  // PLAN SINIRI KOPYALAMA YOLUNDA DA GEÇERLİ (denetim, 07-31). Bu rota eskiden
  // hiç saymıyordu: aynı kaydı 20 kez kopyalayan host hedef dairede 20 aktif
  // kayıt üretebiliyor, yani "daire başına N kayıt" sözü tek düğmeyle
  // delinebiliyordu. Sayım HEDEF DAİRE BAŞINA yapılır (sınır daire başına).
  //
  // Kısmi başarı bilinçli: sınırı dolmuş daire ATLANIR, diğerlerine kopyalanır
  // ve kaç tanesinin atlandığı çağırana DÖNER. Hepsini birden reddetmek, 10
  // daireden biri dolu diye 9 başarılı kopyayı iptal etmek olurdu.
  const limits = await limitsForOrg(session.organizationId);

  // KARAKTER KAPISI BURADA DA (denetim, 07-31). CLAUDE.md "POST ve PATCH ve
  // COPY" diyordu ama COPY'de yalnız ADET kontrolü vardı: tavan ÜSTÜNDEKİ eski
  // bir kayıt (20.000 karakter) tek düğmeyle 24 daireye çoğaltılabiliyordu —
  // yani "her şeyi tek kayda doldur" kaçışı fan-out ile geri açılıyordu.
  // Kaynak kaydı KİLİTLEMİYORUZ (o kendi dairesinde düzenlenebilir kalır),
  // yalnız ÇOĞALTILMASINI reddediyoruz.
  if (source.content.length > limits.kbCharsPerItem) {
    return badRequest({
      _: `Bu kayıt ${source.content.length.toLocaleString("tr-TR")} karakter ve kopyalama sınırı olan ${limits.kbCharsPerItem.toLocaleString("tr-TR")} karakteri aşıyor. Önce kaydı kısaltın, sonra kopyalayın.`,
    });
  }

  // KALICI İŞLEM KAYDI (Codex 10-21, migration 81): tekrar güvenliği yalnız kalemlerdeki `clientRequestId`e dayanınca, araya giren başka bir
  // kopyalama o alanı değiştirdiğinde eski işlem unutuluyordu — eski kimlikle yeniden deneme 200 alıp daireleri yeniden güncelliyordu
  // (ölçüldü). Artık işlem başına satır: ilk denemedeki kaynak içerik izi saklanır; aynı kimlik + farklı iz → 409 (hiçbir şey yazılmaz).
  // Aynı izle tekrar aşağıdaki bugünkü yoldan yalnız eksikleri yazar.
  // Geçerli hedef yoksa hiçbir şey yazılmaz → işlem kaydı da açılmaz (Haiku 10-21 #7: boş istek sonraki gerçek denemeyi 409'a düşürmesin).
  if (typeof rawRequestId === "string" && targets.length > 0) {
    const opKey = { organizationId: session.organizationId, sourceItemId: id, requestId: rawRequestId };
    const hashAtStart = kbContentFingerprint(source);
    // Eski kayıtlar (30 gün) işletme kapsamında temizlenir — en iyi çaba.
    await prisma.kbCopyOperation
      .deleteMany({ where: { organizationId: session.organizationId, createdAt: { lt: new Date(Date.now() - KB_COPY_OPERATION_TTL_MS) } } })
      .catch(() => {});
    let firstHash: string;
    try {
      firstHash = (await prisma.kbCopyOperation.create({ data: { ...opKey, sourceHash: hashAtStart }, select: { sourceHash: true } })).sourceHash;
    } catch (err) {
      if (!isUniqueViolation(err, ["organizationId", "sourceItemId", "requestId"])) throw err;
      firstHash = (
        await prisma.kbCopyOperation.findUniqueOrThrow({ where: { organizationId_sourceItemId_requestId: opKey }, select: { sourceHash: true } })
      ).sourceHash;
    }
    if (firstHash !== hashAtStart) {
      return NextResponse.json({ error: KB_COPY_CONFLICT_MESSAGE, code: KB_IDEMPOTENCY_CONFLICT }, { status: 409 });
    }
  }

  // Aynı kimlik, FARKLI içerik (kurucu 10-15): ilk deneme bazı dairelere yazdı, kaynak ARADA değişti, eski sekme aynı kimlikle yeniden
  // denedi → bazı daireler eski, bazıları yeni metinle kalırdı. Artık HİÇBİR şey yazılmadan açık uyuşmazlık (409); istemci kimliği bırakır,
  // bilerek yeniden kopyalama YENİ işlemdir (yeni kimlik → her daireye güncel metin). Aynı içerikli yeniden deneme (A / B yazıldı, C düştü)
  // aynen sürer: yalnız eksik daireler yazılır.
  if (copyKey != null && targets.length > 0) {
    const earlier = await prisma.knowledgeBaseItem.findMany({
      where: { propertyId: { in: targets.map((t) => t.id) }, clientRequestId: copyKey },
      select: { category: true, title: true, content: true, language: true, copiedContentHash: true },
    });
    // Kıyas kopyanın YAZILDIĞI andaki içerikle (`copiedContentHash`), şimdiki içeriğiyle değil (Opus O10a): hedefteki kopya arada elle
    // düzenlendiyse kaynak DEĞİŞMEMİŞTİR — "Kaynak bilgi bu arada değişti" demek yanlıştı. İzi olmayan (68 öncesi) kopyada eski kıyas.
    const hashNow = kbContentFingerprint(source);
    if (earlier.some((e) => (e.copiedContentHash !== null ? e.copiedContentHash !== hashNow : !sameKbContent(e, source)))) {
      return NextResponse.json({ error: KB_COPY_CONFLICT_MESSAGE, code: KB_IDEMPOTENCY_CONFLICT }, { status: 409 });
    }
  }

  // Gece-4 S5-05: KAYNAK BAĞI "yerine koy" ZİNCİRİNİ izler. Geçmişten öğren L2 "eskisinin yerine koy" YENİ kimlikli kalem açıp eskisini
  // emekliye ayırır (`supersededById`); kopyalar eski kimliğe bağlı kaldığı için yeni kalemi kopyalamak hedefte İKİNCİ etkin kopya açıyordu
  // (B dairesinde eski + yeni Wi-Fi şifresi yan yana; yapay zekâ eskisini söyleyebilir). Kaynağın kendi dairesindeki öncülleri (bu kaleme
  // giden yerine-koy zinciri, en çok 20 adım) de bağ sayılır; bulunan kopya güncellenir ve bağı bu kaleme taşınır.
  const lineage = [id];
  let frontier = [id];
  for (let depth = 0; frontier.length > 0 && depth < 20; depth++) {
    frontier = (
      await prisma.knowledgeBaseItem.findMany({
        where: { propertyId: source.propertyId, supersededById: { in: frontier }, id: { notIn: lineage } },
        select: { id: true },
      })
    ).map((r) => r.id);
    lineage.push(...frontier);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skippedAtLimit = 0;
  /** Elle değiştirildiği (ya da tam o anda düzenlendiği) için dokunulmayan daireler — ekranda adlarıyla gösterilir (kurucu D2). */
  const skippedModified: { propertyId: string; name: string; reason: "modified" | "concurrent" }[] = [];
  const sourceHash = kbContentFingerprint(source);
  const warmTargets: string[] = [];
  for (const t of targets) {
    // Önce "bu istek bu daireye zaten kopyaladı mı?" — sınır sayımından ÖNCE: ilk deneme sınırı doldurduysa yeniden deneme "atlandı" demesin.
    if (await alreadyCopied(t.id)) {
      // Yeniden deneme: ilk istek yazıp eşitlemeden ÖNCE kesildiyse hafıza / vektör eşitlemesi burada tamamlanır (ekleme rotasının
      // `replay`i gibi; ikisi de tekrar güvenli — Opus 10-15 B2).
      warmTargets.push(t.id);
      continue;
    }
    // ESKİ KOPYAYI GÜNCELLE (kurucu D2, 10-15, aynen: "Yalnız seçtiğim hedeflerde, bu kaynaktan geldiği doğrulanmış ve son kopyalamadan
    // beri yerelde değiştirilmemiş kalem güncellensin. Yerel değişiklik varsa üzerine yazma; hangi dairede neden atlandığını göster.
    // Eşzamanlı düzenlemeyi de koru. Kaynak bağı bilinmeyen eski kayıtları benzerliğe göre eşleştirme."). Kaynak bağı = `copiedFromId`
    // (migration 68); "değiştirilmemiş" = şimdiki içerik izi kopyalandığı andaki izle aynı. Bağı olmayan eski kopya HİÇ eşleştirilmez
    // (yeni kopya açılır — kurucu). Güncelleme koşullu: okuma ile yazma arasında ev sahibi o kalemi düzenlediyse (`updatedAt` değişti)
    // yazılmaz, "az önce düzenlendi" diye atlanır. Plan sınırı yalnız YENİ kalemi sayar (güncelleme kalem eklemez).
    // Doğrudan bu kaleme bağlı kopya önce; yoksa zincirdeki en yeni öncülün kopyası.
    const priors = await prisma.knowledgeBaseItem.findMany({
      where: { propertyId: t.id, copiedFromId: { in: lineage } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        category: true,
        title: true,
        content: true,
        language: true,
        copiedContentHash: true,
        updatedAt: true,
        copiedFromId: true,
        supersededById: true,
      },
    });
    const prior = priors.find((p) => p.copiedFromId === id) ?? priors[0] ?? null;
    if (prior) {
      // Hedef dairede kopya yerelde YERİNE KONMUŞSA (L2) ev sahibinin seçtiği yeni kalem korunur — emekli kopyayı "güncellendi" saymak
      // yanıltıcıydı (gece-4 S5-05 ayna vakası).
      if (prior.supersededById !== null) {
        skippedModified.push({ propertyId: t.id, name: t.name, reason: "modified" });
        continue;
      }
      if (prior.copiedContentHash === null || prior.copiedContentHash !== kbContentFingerprint(prior)) {
        skippedModified.push({ propertyId: t.id, name: t.name, reason: "modified" });
        continue;
      }
      if (prior.copiedContentHash === sourceHash && prior.copiedFromId === id) {
        unchanged++;
        warmTargets.push(t.id);
        continue;
      }
      // Bağ taşınırken aynı anda bu kaleme bağlı başka kopya açıldıysa (iki sekme) kaybeden "tam şu anda düzenlendi" yoluna düşer.
      const relinkLost = (err: unknown) => {
        if (isUniqueViolation(err, ["propertyId", "copiedFromId"])) return { count: 0 };
        throw err;
      };
      const res = await prisma.knowledgeBaseItem.updateMany({
        where: { id: prior.id, updatedAt: prior.updatedAt, copiedContentHash: prior.copiedContentHash },
        data: {
          category: source.category,
          title: source.title,
          content: source.content,
          language: source.language,
          copiedContentHash: sourceHash,
          // Bağ zincirdeki öncülden bu kaleme taşınır (S5-05) — sonraki kopyalama doğrudan bulur.
          copiedFromId: id,
          // İŞLEM KİMLİĞİ GÜNCELLENEN KALEME DE YAZILIR (Codex 10-16, ölçüldü): yalnız YENİ kopya kimliği taşıyordu → A güncellendi, C düştü,
          // kaynak arada değişti, aynı kimlikle yeniden deneme "kaynak değişti" uyuşmazlığını (409) görmeden iki kopyayı da yeni metne
          // çeviriyordu. Artık tekrar bu kalemi "bu işlem yazdı" diye tanır (atlar) ve yukarıdaki içerik izi kıyası güncellenen kalemi de
          // kapsar. Kalemin eski oluşturma kimliğinin yerini alır: eski işlemin tekrarı kopyayı kaynak bağından (`copiedFromId`) bulur, ikinci
          // kalem açılmaz; o eski kimliğin tekrarı 409 yerine kaynağın GÜNCEL içeriğiyle ilerler (bütün yazımlar güncel sürüme yakınsar —
          // daireler arasında karışık içerik oluşmaz; "aynı kimlik → 409" sözü yalnız kalemi en son yazan işlem için geçerli, Haiku 10-16).
          ...(copyKey != null ? { clientRequestId: copyKey } : {}),
          // Onay soyu kaynaktan (yeni kopya ile aynı kural — ↓ create yorumu).
          source: source.source,
          reviewState: source.reviewState,
          approvedAt: source.approvedAt,
        },
      }).catch(relinkLost);
      if (res.count === 0) {
        // Kaybeden taraf yeniden okur (Opus O10b): aynı anda AYNI kaynağı yazan başka bir istekse kopya zaten güncel → "güncellendi" say;
        // yalnız gerçekten başka içerik yazıldıysa "tam şu anda düzenlendi".
        const now = await prisma.knowledgeBaseItem.findUnique({ where: { id: prior.id }, select: { copiedContentHash: true, category: true, title: true, content: true, language: true } });
        if (now && now.copiedContentHash === sourceHash && kbContentFingerprint(now) === sourceHash) {
          unchanged++;
          warmTargets.push(t.id);
        } else {
          skippedModified.push({ propertyId: t.id, name: t.name, reason: "concurrent" });
        }
        continue;
      }
      updated++;
      warmTargets.push(t.id);
      continue;
    }
    if (source.isActive) {
      const activeCount = await prisma.knowledgeBaseItem.count({
        where: { propertyId: t.id, isActive: true },
      });
      if (activeCount >= limits.kbItemsPerProperty) {
        skippedAtLimit++;
        continue;
      }
    }
    try {
      await prisma.knowledgeBaseItem.create({
        data: {
          propertyId: t.id,
          category: source.category,
          title: source.title,
          content: source.content,
          language: source.language,
          isActive: source.isActive,
          // ONAY SOYU DEVRALINIR (A1, 09-08) — iki yönlü gerekçe:
          //  · Kaynak `legacy` ise kopya da `legacy` olur. Kopyalama düğmesine
          //    basmak, o metnin İÇERİĞİNİ gözden geçirmek değildir; kopyaya
          //    "host onayladı" yazmak tam olarak kurucunun yasakladığı varsayım.
          //  · Kaynak `draft` ise kopya da `draft` kalır. Aksi hâlde kopyalama,
          //    onaydan geçmemiş bir taslağı tek tıkla MODELE SOKAN kaçış olurdu.
          // `approvedAt` de soydan gelir: kopya kendi başına onaylanmadı, hangi
          // onaya yaslandığı ise kaynağın onay zamanıdır.
          source: source.source,
          reviewState: source.reviewState,
          approvedAt: source.approvedAt,
          clientRequestId: copyKey,
          // Kaynak bağı + içerik izi (kurucu D2, migration 68): sonraki kopyalama bu kopyayı güncelleyebilsin.
          copiedFromId: id,
          copiedContentHash: sourceHash,
        },
      });
    } catch (err) {
      // Eş zamanlı iki deneme: kaybeden, kazananın bu dairedeki kopyasını bulur (yalnız BU benzersizlik ihlali; başkası fırlar).
      if (copyKey != null && isUniqueViolation(err, ["propertyId", "clientRequestId"])) continue;
      // Farklı kimlikli iki kopyalama aynı anda (iki sekme / iki yönetici — Opus O9): daire başına kaynak başına TEK bağlı kopya
      // (`@@unique([propertyId, copiedFromId])`, migration 68). Kaybeden kazananın kopyasını okur: aynı içerikse "güncel", değilse atlandı.
      if (isUniqueViolation(err, ["propertyId", "copiedFromId"])) {
        const winner = await prisma.knowledgeBaseItem.findFirst({
          where: { propertyId: t.id, copiedFromId: id },
          select: { copiedContentHash: true },
        });
        if (winner?.copiedContentHash === sourceHash) {
          unchanged++;
          warmTargets.push(t.id);
        } else {
          skippedModified.push({ propertyId: t.id, name: t.name, reason: "concurrent" });
        }
        continue;
      }
      throw err;
    }
    created++;
    warmTargets.push(t.id);
  }
  // V1: hedef mülklerin hafızası anında eşitlenir (org kapsamı; fırlatmaz).
  if (warmTargets.length > 0) await refreshPropertyMemoryBestEffort(session.organizationId);
  // #189: hedef mülklerin anlamsal vektörleri yazma anında (beklemez, fırlatmaz).
  for (const id of warmTargets) warmPropertyKbVectorsBestEffort(id);

  const notices: string[] = [];
  if (skippedAtLimit > 0) {
    notices.push(`${skippedAtLimit} daire, planınızın bilgi tabanı sınırına (daire başına ${limits.kbItemsPerProperty} kayıt) ulaştığı için atlandı.`);
  }
  const modifiedNames = skippedModified.filter((x) => x.reason === "modified").map((x) => x.name);
  if (modifiedNames.length > 0) {
    notices.push(`Şu dairelerdeki kopya elle değiştirildiği için güncellenmedi: ${modifiedNames.join(", ")}.`);
  }
  const concurrentNames = skippedModified.filter((x) => x.reason === "concurrent").map((x) => x.name);
  if (concurrentNames.length > 0) {
    notices.push(`Şu dairelerdeki kopya tam şu anda düzenlendiği için güncellenmedi: ${concurrentNames.join(", ")}.`);
  }
  return jsonOk({
    ok: true,
    created,
    updated,
    unchanged,
    skippedAtLimit,
    skippedModified,
    ...(notices.length > 0 ? { notice: notices.join(" ") } : {}),
  });
});
