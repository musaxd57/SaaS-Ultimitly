import { describe, it, expect } from "vitest";
import { admitsMissingKnowledge } from "@/lib/ai/absence";

// ---------------------------------------------------------------------------
// "BİLGİM YOK" MİSAFİRE GİTMEZ — DİL KAPSAMI (10-01 gece ölçümü).
//
// Kurucu kuralı (09-11) dilden bağımsızdır: "müşteriye hiçbir zaman 'bilgim yok' mesajı gitmemeli". Yüklem yalnız Türkçe ve
// İngilizce biliyordu; canlı hat ölçümünde (luna-dev-2, gpt-6-luna) iki yokluk itirafı kapıdan geçip misafire GİTTİ:
//   · "Yakınlarda kuaför bilgisi elimde olmadığı için bu konuda ev sahibiniz size kesin bilgi verebilir."
//   · "Les règles concernant la visite de vos amis pour le dîner ne sont pas précisées ici."
// Ürünün desteklediği yedi dilin hepsinde aynı NESNE + OLUMSUZLAMA dilbilgisi (`absence.ts` başlığı). İkinci yarı (meşru cevap
// TUTULMAZ) olmadan "genişletme" fark edilmez: her dilde olumsuz ama yokluk itirafı OLMAYAN cümleler pinli.
// ---------------------------------------------------------------------------

const ADMITS: Record<string, string[]> = {
  tr: [
    "Yakınlarda kuaför bilgisi elimde olmadığı için bu konuda ev sahibiniz size kesin bilgi verebilir.",
    "Kuaför bilgisi elimde değil.",
    "Maalesef bu detay elimde bulunmuyor.",
    "Bu konuda bilgim olmadığı için kesin bir şey söyleyemem.",
    "Bu bilgiye sahip olmadığım için ev sahibinize sorabilirsiniz.",
    "Bu konuda bilgi bulunmadığından kesin cevap veremiyorum.",
    "Ziyaretçi kuralları burada belirtilmemiş.",
  ],
  en: [
    "The rules about visitors aren't specified here.",
    "The pool hours are not mentioned in my notes.",
  ],
  fr: [
    "Les règles concernant la visite de vos amis pour le dîner ne sont pas précisées ici.",
    "Je n'ai pas d'information sur ce point.",
    "Je n’ai pas cette information.",
    "Nous n'avons pas de détails à ce sujet.",
    "Aucune information n'est disponible sur le parking.",
    "Je ne dispose pas de cette information.",
    "Je ne sais pas si le restaurant est ouvert le dimanche.",
    "Ce point n'est pas mentionné dans mes informations.",
    "Je n'ai aucune information à ce sujet.",
  ],
  de: [
    "Dazu liegen mir keine Informationen vor.",
    "Ich habe keine genauen Angaben zum Parkplatz.",
    "Das ist in meinen Unterlagen nicht angegeben.",
    "Das weiß ich leider nicht.",
    "Ich weiß es nicht genau.",
    "Den Friseur kann ich leider nicht finden.",
    "Es gibt dazu keine Informationen.",
    // 5.1'in 09-30 kabul koşusunda misafire gidecek gerçek itirafı: fiil ile "keine" arasında 5 sözcük.
    "Zu einer Badewanne habe ich in meinen Unterlagen leider keine eindeutige Information.",
  ],
  es: [
    "No tengo información sobre el aparcamiento.",
    "No dispongo de esos datos.",
    "No hay información sobre eso en mis notas.",
    "No se especifica en las normas.",
    "No lo sé con seguridad.",
    "Ningún detalle sobre eso figura aquí.",
  ],
  ru: [
    "У меня нет информации о парковке.",
    "К сожалению, нет точных данных об этом.",
    "Это не указано в моих записях.",
    "Я не знаю, работает ли бассейн.",
    "Не могу найти эту информацию.",
    "Информация о парковке отсутствует.",
  ],
  ar: [
    "ليس لدي معلومات عن موقف السيارات.",
    "لا تتوفر لدي معلومات حول ذلك.",
    "لا أعرف إذا كان المسبح مفتوحا.",
    "هذه المعلومة غير مذكورة.",
  ],
};

// Olumsuz ama yokluk itirafı OLMAYAN meşru cevaplar — tutulursa işe yarayan cevap misafire gitmez.
const LEGIT: Record<string, string[]> = {
  tr: [
    "Otopark bilgisi elimde: P2 numaralı yer sizin.",
    "Aksi belirtilmemişse çıkış saati 11:00'dir.",
    "Kayıt olmadığı sürece görevli kapıyı açmaz; giriş kodu 4821.",
    "Otopark için ek ücret yok.",
  ],
  en: ["The pool is not specified as closed; it is open 09:00-20:00.", "Smoking is not allowed in the apartment."],
  fr: [
    "Il n'y a pas de frais supplémentaires.",
    "Le parking est gratuit, aucune réservation n'est nécessaire.",
    "Si vous ne trouvez pas la clé, elle est dans la boîte aux lettres.",
    "Toutes les informations sont dans le guide d'accueil.",
    "Aucun problème, l'arrivée est possible à partir de 15h.",
    "Les animaux ne sont pas acceptés dans l'appartement.",
    "Il n'est pas indiqué de laisser les fenêtres ouvertes la nuit.",
    // Olumsuz İHTİYAÇ ("…gerek yok") itiraf değildir.
    "Vous n'avez besoin d'aucune information supplémentaire pour l'arrivée.",
  ],
  de: [
    "Es fallen keine zusätzlichen Kosten an.",
    "Sie brauchen keinen Schlüssel, die Tür hat einen Code.",
    "Rauchen ist in der Wohnung nicht gestattet.",
    "Keine Sorge, der Check-in ist ab 15 Uhr möglich.",
    "Alle Informationen finden Sie im Gästebuch.",
    "Falls Sie den Schlüssel nicht finden können, liegt er im Briefkasten.",
    "Sie brauchen keine weiteren Angaben zu machen, der Check-in ist ab 15 Uhr.",
    "Sie müssen uns keine Informationen vorab schicken.",
  ],
  es: [
    "No hay ningún cargo adicional.",
    "No se permiten mascotas en el apartamento.",
    "No es necesario reservar el aparcamiento.",
    "Toda la información está en la guía de bienvenida.",
    "No hay datos móviles incluidos, pero el wifi es gratuito.",
  ],
  ru: [
    "Нет, курить в квартире нельзя.",
    "Парковка бесплатная, бронировать не нужно.",
    "Нет проблем, заезд с 15:00.",
    "Если вы не знаете дорогу, пришлю инструкцию: от метро 5 минут пешком.",
  ],
  ar: ["لا يوجد رسوم إضافية.", "لا يسمح بالتدخين في الشقة.", "المسبح غير متاح بعد الساعة 20:00."],
};

describe("'bilgim yok' yüklemi — yedi dil (kurucu kuralı dilden bağımsız)", () => {
  for (const [lang, list] of Object.entries(ADMITS)) {
    it(`${lang}: açık yokluk itirafı TUTULUR`, () => {
      for (const m of list) expect(admitsMissingKnowledge(m), m).toBe(true);
    });
  }
  for (const [lang, list] of Object.entries(LEGIT)) {
    it(`${lang}: olumsuz ama itiraf olmayan meşru cevap TUTULMAZ`, () => {
      for (const m of list) expect(admitsMissingKnowledge(m), m).toBe(false);
    });
  }

  it("ölçümde misafire giden iki cevap artık kapıda (tam metin)", () => {
    expect(
      admitsMissingKnowledge(
        "Merhaba Alex,\n\nSize ayrılan otopark yeri P2. Yakınlarda kuaför bilgisi elimde olmadığı için bu konuda ev sahibiniz size kesin bilgi verebilir.",
      ),
    ).toBe(true);
    expect(
      admitsMissingKnowledge(
        "Bonjour Alex,\n\nLes animaux de moins de 10 kg sont acceptés avec des frais de ménage de 300 TL par séjour, à condition de nous en informer à l’avance. Les règles concernant la visite de vos amis pour le dîner ne sont pas précisées ici.",
      ),
    ).toBe(true);
  });

  it("büyük harf ve ayrıştırılmış aksan (NFD) da tutulur", () => {
    expect(admitsMissingKnowledge("JE N'AI PAS D'INFORMATION SUR CE POINT.")).toBe(true);
    expect(admitsMissingKnowledge("Les règles ne sont pas précisées ici.")).toBe(true);
  });
});
