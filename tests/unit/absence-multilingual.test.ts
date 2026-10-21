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

// ── 10-01 öğlen (karar 23 kör doğrulaması): "… bilgide YOK" kalıbı — yer BİLGİ nesnesine çapalı. Luna'nın misafire GİDEN cümlesi:
// "The coffee machine troubleshooting steps aren't available in the information provided." Her dilde meşru ikiz (yer bilgi değil) pinli.
const ADMITS_IN_INFO: Record<string, string[]> = {
  en: [
    "Your parking spot is number 27, on level -1 at the back of the building. The coffee machine troubleshooting steps aren't available in the information provided.",
    "The coffee machine troubleshooting steps are not available in the information provided.",
    "This isn't included in the details I have.",
    "We don't have specific instructions for the coffee machine.",
    "There are no instructions for the coffee machine.",
  ],
  tr: ["Kahve makinesi için arıza adımları elimdeki bilgilerde yer almıyor."],
  es: ["Los pasos para la cafetera no están disponibles en la información proporcionada."],
  fr: ["Les étapes pour la machine à café ne sont pas disponibles dans les informations fournies."],
  de: ["Die Schritte für die Kaffeemaschine sind in den vorliegenden Informationen nicht verfügbar."],
  ru: ["В предоставленной информации нет инструкций для кофемашины."],
  ar: ["خطوات إصلاح آلة القهوة غير متوفرة في المعلومات المقدمة."],
};
const LEGIT_IN_INFO: Record<string, string[]> = {
  en: [
    "Breakfast is not included in the price.",
    "Parking is not included in the rate.",
    "You don't have to take any steps, the heating starts automatically.",
    "There are no steps at the entrance, it is wheelchair accessible.",
    "Instructions for the coffee machine are on the fridge door.",
  ],
  tr: ["Havuz bilgileri ev kurallarında yer alıyor.", "Otopark ücreti fiyata dahil değil."],
  es: ["La piscina no está disponible en invierno.", "El desayuno no está incluido en el precio."],
  fr: ["La piscine n'est pas disponible dans la journée.", "Le petit-déjeuner n'est pas inclus dans le prix."],
  de: ["Das Frühstück ist im Preis nicht enthalten.", "Die Sauna ist in den Wintermonaten nicht verfügbar."],
  ru: ["В квартире нет утюга, но есть отпариватель.", "Нет, курить нельзя."],
  ar: ["غير متاح في الشتاء.", "المسبح غير متاح بعد الساعة 20:00."],
};

// ── Kör set 5 (10-01 öğlen): "TALİMATIM yok" — misafire GİDEN iki cümle ("I don't have specific troubleshooting steps in my guide" — 5.1;
// "Je n'ai pas de consigne disponible pour résoudre le problème du micro-ondes" — Luna). Yalnız 1. şahıs / varlık yüklemiyle; "özel talimat
// yok" (olgu) ve "You don't have any steps to climb" tutulmaz.
const ADMITS_INSTRUCTIONS: string[] = [
  "For the terrace jacuzzi, I don’t have specific troubleshooting steps in my guide, so I can’t give a reliable fix remotely.",
  "We don't have any guidance for the jacuzzi pump.",
  "There are no troubleshooting instructions for the jacuzzi.",
  "Votre place est la P-14. Je n’ai pas de consigne disponible pour résoudre le problème du micro-ondes.",
  "Nous n'avons aucune instruction pour le jacuzzi.",
  "Wenn die Kaffeemaschine laut pumpt, ist dazu keine Anleitung verfügbar.",
  "No tengo instrucciones para la cafetera.",
  "У меня нет инструкций для кофемашины.",
  "ليس لدي تعليمات بخصوص آلة القهوة.",
  // Opus 10-15 (ölçüldü, ikisi de geçiyordu): Türkçe 1. şahıs iyelik + İngilizce "… in my notes" yer çapası.
  "Televizyon için talimatım yok.",
  "Kayıtlı bir talimatımız bulunmuyor, ev sahibiniz yardımcı olacaktır.",
  "There are no troubleshooting steps for the TV in my notes.",
];
// Kurucu 10-17 öncesi burada "özel talimat yok" olguları da vardı ("Çöp için özel bir talimat yok, …", "No special instructions for
// checkout, …"); kurucu kararıyla artık misafire GİTMEZLER (↓"niteleyicili 'talimat yok'" bloğu). Kalan: 2. şahıs / "gerekmiyor" biçimleri.
const LEGIT_INSTRUCTIONS: string[] = [
  "There are no steps to the front door, the entrance is level.",
  "You don't have any steps to climb, the entrance is level.",
  "You don't have to follow any special steps for checkout.",
  "Vous n'avez besoin d'aucune instruction particulière pour l'arrivée.",
  "Sie brauchen keine Anleitung, die Maschine startet automatisch.",
  "Sie brauchen keine besonderen Anweisungen, die Tür ist offen.",
  "Giriş için özel bir talimat gerekmiyor.",
  // Haiku 10-17: "gerek" biçimi İngilizcede de olgu (eskiden genel "no … instructions for" kalıbı tutuyordu).
  "You need no special instructions for checkout.",
  "No special instructions are needed for checkout.",
];

// ── Kör set 6 (10-01 öğleden sonra, Luna — misafire GİTTİ): "Zum kabellosen Lautsprecher finde ich keine Angaben." — 1. şahıs "BULAMADIM"
// itirafı yedi dilde (ölçüm: 25 biçimin 16'sı kaçıyordu). Yalnız 1. şahıs + bilgi nesnesi; 2. şahıs koşul ("Wenn Sie … nicht finden", "Si
// no encuentra el mando…") ve "bulamazsınız / trouverez aucun frais" olguları tutulmaz.
const ADMITS_NOT_FOUND: Record<string, string[]> = {
  de: [
    "Hallo Alex,\n\nZum kabellosen Lautsprecher finde ich keine Angaben. Die nächstgelegene Badestelle ist die Mavikum-Bucht.",
    "Ich finde leider keine Informationen zum Lautsprecher.",
    "Dazu finde ich keine Hinweise.",
    "Zum Lautsprecher habe ich leider nichts gefunden.",
    "Zum Mixer konnte ich keine Informationen finden.",
    // Talimat nesnesi bulma fiiliyle de ("Anleitung / Anweisung", `DE_INFO`).
    "Für den Lautsprecher finde ich keine Anleitung.",
    "Ich konnte keine Anweisungen zum Mixer finden.",
    // 5.1, aynı satır (GİTTİ): talimat nesnesi + 1. şahıs sahiplik.
    "Für den kabellosen Lautsprecher habe ich in meinen Unterlagen leider keine spezifische Anleitung, dazu kann ich daher nichts Verlässliches sagen.",
  ],
  en: ["I didn't find any information about the speaker.", "I did not find any details on the blender."],
  fr: ["Je ne trouve aucune information sur l'enceinte.", "Je n'ai trouvé aucune information concernant l'enceinte."],
  es: ["No he encontrado información sobre la licuadora."],
  ru: ["Я не нахожу информации о колонке.", "Не нашёл информации о колонке.", "Не нашла сведений о блендере."],
  ar: ["لا أجد معلومات عن مكبر الصوت.", "لم أجد أي معلومات حول الخلاط."],
  tr: ["Hoparlör hakkında bilgiye ulaşamadım.", "Blender için bir bilgiye ulaşamıyorum.", "Hoparlörle ilgili bilgi bulamadık."],
};
const LEGIT_NOT_FOUND: Record<string, string[]> = {
  de: [
    "Wenn Sie den Schlüssel nicht finden, liegt er im Briefkasten.",
    "Falls Sie keine Handtücher finden, liegen weitere im Schrank.",
    "Ich finde, die Bucht ist der schönste Ort hier.",
    "Sie finden keine Gebühren für das Parken.",
    "Im Schrank finden Sie keine Bettwäsche, diese liegt im Flur.",
    "Ich finde keine Worte, so schön ist die Bucht.",
    // 2. şahıs + bilgi nesnesi (olgu: bilginin NEREDE olmadığı) — özne şartının pini.
    "Im Gästebuch finden Sie keine Angaben zu Preisen, diese stehen in der App.",
  ],
  en: [
    "You won't find any fees for parking.",
    "If we don't see any issues, the deposit is returned in full.",
    "You won't find any information about prices in the folder; they are on the booking page.",
  ],
  fr: ["Si vous ne trouvez pas la télécommande, elle est dans le tiroir.", "Vous ne trouverez aucun frais de parking."],
  es: ["Si no encuentra el mando, está en el cajón.", "No encontrará ningún cargo por el aparcamiento."],
  ru: ["Если не найдёте пульт, он в ящике.", "Вы не найдёте лучшего пляжа поблизости."],
  ar: ["إذا لم تجدوا المفتاح فهو في الصندوق."],
  tr: ["Anahtarı bulamazsanız kutunun içinde.", "Otopark için ek ücret bulunmuyor."],
};

// ── 10-01 gece (RC60 regresyon koşusu, kör set 5 — Luna, misafire GİTTİ): "ÇÖZÜM ÖNEREMİYORUM" sınıfı. Anlama katmanı arızayı tutulacak öğe
// saymadığında (model değişkenliği) bırakılan cihaz kapısı koşmuyor; son kemer bu yüklem. Ölçüm: 21 biçimin 21'i kaçıyordu; 3.031 cevaplık
// korpusta ve gecenin 3.033 canlı hat metninde yeni tutma yalnız sızan cevap. Özne 1. şahıs + olumsuz kip + ÇÖZÜM nesnesi ŞART.
const ADMITS_NO_SOLUTION: Record<string, string[]> = {
  de: [
    "Hallo Alex,\n\nBei der Kaffeemaschine kann ich anhand der vorliegenden Informationen keine passende Lösung nennen. Den Müll können Sie in den grauen Container links vom Hauseingang werfen.",
    "Für die Kaffeemaschine kann ich Ihnen leider keine Lösung anbieten.",
    "Ich kann Ihnen zur Kaffeemaschine keine Lösung nennen.",
    "Zur Kaffeemaschine kann ich keinen Lösungsvorschlag machen.",
    "Ich konnte keine Lösung für die Kaffeemaschine finden.",
    "Anhand der vorliegenden Informationen kann ich dazu nichts Konkretes sagen.",
  ],
  en: [
    "I can't offer a solution for the coffee machine based on the information I have.",
    "Based on the information available, I'm unable to suggest a fix for the coffee machine.",
    "I'm not able to provide a solution for the microwave.",
    "I cannot recommend a fix for the dishwasher from here.",
    "I'm unable to offer any troubleshooting for the jacuzzi.",
    "We're not able to give you a fix for the dryer.",
  ],
  fr: [
    "Je ne peux pas vous proposer de solution pour le micro-ondes.",
    "Pour le micro-ondes, je ne suis pas en mesure de proposer une solution.",
    "D'après les informations disponibles, je ne peux pas indiquer de solution pour le micro-ondes.",
    "Je n'ai pas de solution pour le micro-ondes.",
  ],
  es: [
    "No puedo ofrecerle una solución para la cafetera.",
    "Con la información disponible no puedo indicarle ninguna solución para la cafetera.",
    "No tengo una solución para la cafetera.",
  ],
  ru: [
    "Я не могу предложить решение для кофемашины.",
    "По имеющейся информации не могу подсказать решение для кофемашины.",
    "У меня нет решения для кофемашины.",
  ],
  ar: ["لا أستطيع تقديم حل لمشكلة آلة القهوة.", "لا يمكنني اقتراح حل لآلة القهوة بناءً على المعلومات المتاحة.", "لم أتمكن من إيجاد حل لآلة القهوة."],
  tr: [
    "Kahve makinesi için bir çözüm öneremiyorum.",
    "Mevcut bilgilere göre kahve makinesi için bir çözüm sunamıyorum.",
    "Kahve makinesiyle ilgili size bir çözüm veremiyorum.",
    "KAHVE MAKİNESİ İÇİN BİR ÇÖZÜM SUNAMIYORUM.",
    "Kahve makinesi için bir çözüm bulamadım.",
  ],
};
const LEGIT_SOLUTION: Record<string, string[]> = {
  de: [
    "Die Lösung: Halten Sie die Taste 3 Sekunden gedrückt.",
    "Eine schnelle Lösung ist, den Stecker zu ziehen und neu zu starten.",
    "Sie können keine Lösung falsch machen, beide Tasten funktionieren.",
    "Laut den vorliegenden Informationen ist das Rauchen nicht erlaubt.",
    "Ich kann mir keine bessere Lösung vorstellen, als den Bus zu nehmen.",
    "Für den Weg zum Strand kann ich mir keine bessere Lösung vorstellen als den Bus.",
    "Ich kann Ihnen eine Lösung anbieten: Halten Sie die Taste gedrückt.",
    "Ich kann nichts anderes sagen als: herzlich willkommen!",
  ],
  en: [
    "The solution is to hold the reset button for 5 seconds.",
    "I can offer a solution: hold the reset button for 5 seconds.",
    "We can't offer a discount on the cleaning fee.",
    "If that doesn't fix it, the breaker is in the hallway.",
  ],
  fr: [
    "La solution : maintenez le bouton enfoncé 5 secondes.",
    "Je ne peux que vous proposer une solution : le bus de 8 h.",
    "Je peux vous proposer une solution : redémarrez le routeur.",
    "Vous ne pouvez pas rater la solution, elle est sur la porte.",
    "Je ne peux pas garantir que cette solution fonctionne pour les gros bagages.",
  ],
  es: [
    "La solución es mantener pulsado el botón 5 segundos.",
    "Puedo ofrecerle una solución: reinicie el router.",
    "Si no encuentra solución, llame al número de la caja.",
    "No puedo esperar a recibirles, la solución de aparcamiento está lista.",
    "No puedo garantizar que la solución funcione para maletas grandes.",
  ],
  ru: ["Решение: удерживайте кнопку 5 секунд.", "Могу предложить решение: перезагрузите роутер.", "Если вы не можете найти решение, позвоните по номеру на двери."],
  ar: ["الحل هو الضغط على الزر لمدة 5 ثوان.", "أستطيع تقديم حل: أعد تشغيل الراوتر.", "إذا لم تستطيعوا إيجاد حل، اتصلوا بالرقم."],
  tr: [
    "Çözüm: düğmeye 5 saniye basılı tutun.",
    "Size bir çözüm önerim var: fişi çekip 1 dakika bekleyin.",
    "Çözüm bulamazsanız anahtar kutusundaki numarayı arayın.",
    "Bu sorunun çözümü kolay: sigortayı kaldırın.",
  ],
};

describe("'çözüm öneremiyorum' itirafı (10-01 gece, kör set 5 regresyonu) — yedi dil, iki yön", () => {
  for (const [lang, list] of Object.entries(ADMITS_NO_SOLUTION)) {
    it(`${lang}: 1. şahıs "çözüm öneremiyorum / bulamadım" TUTULUR`, () => {
      for (const m of list) expect(admitsMissingKnowledge(m), m).toBe(true);
    });
  }
  for (const [lang, list] of Object.entries(LEGIT_SOLUTION)) {
    it(`${lang}: çözümü VEREN, 2. şahıs, "yalnız" ve başka nesneli olumsuz cümle TUTULMAZ`, () => {
      for (const m of list) expect(admitsMissingKnowledge(m), m).toBe(false);
    });
  }
});

describe("'bulamadım' itirafı (kör set 6, 10-01 öğleden sonra) — yedi dil, iki yön", () => {
  for (const [lang, list] of Object.entries(ADMITS_NOT_FOUND)) {
    it(`${lang}: 1. şahıs "bilgi bulamadım / bulamıyorum" TUTULUR`, () => {
      for (const m of list) expect(admitsMissingKnowledge(m), m).toBe(true);
    });
  }
  for (const [lang, list] of Object.entries(LEGIT_NOT_FOUND)) {
    it(`${lang}: 2. şahıs koşul ve "bulamazsınız" olgusu TUTULMAZ`, () => {
      for (const m of list) expect(admitsMissingKnowledge(m), m).toBe(false);
    });
  }
});

describe("'talimatım yok' (kör set 5, 10-01 öğlen) — iki yön", () => {
  it("1. şahıs / varlık yüklemli 'talimat yok' itirafı TUTULUR", () => {
    for (const m of ADMITS_INSTRUCTIONS) expect(admitsMissingKnowledge(m), m).toBe(true);
  });
  it("'özel talimat gerekmiyor' ve 2. şahıs cümleler TUTULMAZ", () => {
    for (const m of LEGIT_INSTRUCTIONS) expect(admitsMissingKnowledge(m), m).toBe(false);
  });
});

// ── Kurucu 10-17 (H9 cevabı, aynen): "televizyonla ilgili ayrı bir talimatım bulunmuyor böyle birşey yazamaz kesinlikle … Çıkış için özel
// talimatımız yok, anahtarı masaya bırakmanız yeterli. bunun ilk cümlesini yazmasına gerek yok … Çıkış için özel talimatımız yok, bunu
// yazmasın". Opus N5'in (10-15) "niteleyicili 1. şahıs olgudur, tutulmaz" istisnası bu kararla KALKTI.
const QUALIFIED_NO_INSTRUCTION: string[] = [
  "Televizyonla ilgili ayrı bir talimatım bulunmuyor, ev sahibinize ileteceğim.",
  "Çıkış için özel talimatımız yok.",
  "Çıkış için özel talimatımız yok, anahtarı masaya bırakmanız yeterli.",
  "Çıkış için ek bir talimatımız bulunmuyor; anahtarları masada bırakabilirsiniz.",
  "Özel talimatımız yok, rahatça kullanabilirsiniz.",
  "Çöp için özel bir talimat yok, konteynere atabilirsiniz.",
  "There are no other instructions in my notes, so just leave the keys on the table.",
  "No special instructions for checkout, just close the door.",
  "There are no special instructions for checkout.",
  "No hay instrucciones especiales para el check-in; la llave está en el buzón.",
  "Нет особых инструкций, ключ в почтовом ящике.",
  "لا توجد تعليمات خاصة للمغادرة.",
  "Il n'y a pas d'instructions particulières, la clé est dans la boîte.",
  "Es gibt keine besonderen Anweisungen.",
  // Haiku 10-17 (kaçıyordu): 3. şahıs iyelik, "mevcut / söz konusu değil", "belirli / específicas / конкретных / spécifiques / konkreten / محددة".
  "Çıkış için özel talimatı yok, anahtarı masaya bırakın.",
  "Özel talimatımız mevcut değil.",
  "Özel talimat söz konusu değil.",
  "Belirli bir talimat bulunmuyor.",
  "Нет конкретных инструкций.",
  "No hay instrucciones específicas.",
  "Il n'y a pas d'instructions spécifiques.",
  "Ich habe keine konkreten Anweisungen.",
  "لا توجد تعليمات محددة.",
  "There are no specific instructions for the boiler.",
  // Opus 10-17 (en doğal biçimler kaçıyordu).
  "Особых инструкций нет.",
  "لا يوجد تعليمات خاصة للمغادرة.",
  "No hay ninguna instrucción especial.",
  "There aren't any special instructions.",
  "Besondere Anweisungen gibt es nicht.",
  "Il n'y a aucune consigne particulière.",
  "Özel bir talimat bulunmamakta.",
];

describe("niteleyicili 'talimat yok' (kurucu 10-17) — misafire GİTMEZ, yedi dil", () => {
  it("'özel / ek / ayrı talimat(ım/ımız) yok' ve yabancı karşılıkları TUTULUR", () => {
    for (const m of QUALIFIED_NO_INSTRUCTION) expect(admitsMissingKnowledge(m), m).toBe(true);
  });
  it("çıplak 1. şahıs itiraf da tutulur (eski pin) — 'tek' içindeki 'ek' niteleyici değil (Haiku 10-15 gece)", () => {
    for (const m of [
      "Televizyon için talimatım yok.",
      "Kayıtlı bir talimatımız bulunmuyor, ev sahibiniz yardımcı olacaktır.",
      "Kapı kodu için tek talimatımız yok, anahtar masada.",
    ]) {
      expect(admitsMissingKnowledge(m), m).toBe(true);
    }
  });
});

describe("'… bilgide yok' kalıbı (karar 23 kör doğrulaması, 10-01 öğlen) — yedi dil, iki yön", () => {
  for (const [lang, list] of Object.entries(ADMITS_IN_INFO)) {
    it(`${lang}: "bilgide yok / mevcut değil" itirafı TUTULUR`, () => {
      for (const m of list) expect(admitsMissingKnowledge(m), m).toBe(true);
    });
  }
  for (const [lang, list] of Object.entries(LEGIT_IN_INFO)) {
    it(`${lang}: yeri bilgi olmayan "dahil değil / mevcut değil" olgusu TUTULMAZ`, () => {
      for (const m of list) expect(admitsMissingKnowledge(m), m).toBe(false);
    });
  }
});

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

describe("🚨 kurucu 10-18 T3: 'bilgi veremem' HİÇBİR dilde misafire gitmez", () => {
  it("bilgi verme reddi yedi dilde tutulur (eskiden 13'ü gidiyordu)", () => {
    for (const t of [
      "I'm sorry, I can't provide information about the TV.",
      "I'm unable to provide information on that.",
      "I can't give you details about the neighbours.",
      "Bu konuda bilgi sağlayamıyorum.",
      "Size bu bilgiyi vermem mümkün değil.",
      "Diğer misafirlerin bilgilerini paylaşamıyoruz.",
      "Dazu können wir keine Angaben machen.",
      "Je ne peux pas vous donner d'informations sur ce point.",
      "Je ne suis pas en mesure de fournir ces informations.",
      "No puedo proporcionar información sobre eso.",
      "No podemos darle esa información.",
      "Не могу предоставить информацию об этом.",
      "لا أستطيع تقديم معلومات عن ذلك.",
    ])
      expect(admitsMissingKnowledge(t), t).toBe(true);
  });

  it("KONTROL: bilgi nesnesi olmayan ret, politika ve olgu cümleleri gider", () => {
    for (const t of [
      "I can't provide early check-in, sorry.",
      "The Wi-Fi information is on the fridge.",
      "Bilgilerinizi almadan giriş kodunu veremeyiz.",
      "Bilgi için teşekkürler, yarın görüşürüz.",
      "We can share the parking details: spot 12.",
      "No podemos aceptar mascotas.",
      "Не могу дождаться вашего приезда!",
      "Je ne peux pas accepter d'animaux.",
    ])
      expect(admitsMissingKnowledge(t), t).toBe(false);
  });
});

describe("kurucu T1 (10-21): iç kaynak / işleyiş anlatımı misafire gitmez — 'sistemimizde görünmüyor' ailesi", () => {
  it.each([
    "Rezervasyonunuz sistemimizde görünmüyor.",
    "Bu bilgi sistemde yok.",
    "Sistemimizde böyle bir kayıt bulunmuyor.",
    "Your booking is not in our system.",
    "I don't see it in our system.",
    "Our system doesn't show any parking fee.",
    "Bilgi tabanında yok.",
    "Kayıtlarımda bulamadım.",
  ])("TUTULUR: %s", (t) => expect(admitsMissingKnowledge(t)).toBe(true));
  it.each(["Dairede merkezi ısıtma sistemi yok.", "The heating system is electric.", "Sistem çalışıyor, sorun yok.", "Our alarm system is on the wall."])(
    "KONTROL — mülk olgusu, tutulmaz: %s",
    (t) => expect(admitsMissingKnowledge(t)).toBe(false),
  );
});
