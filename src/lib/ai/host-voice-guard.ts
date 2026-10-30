// ---------------------------------------------------------------------------
// MESAJI EV SAHİBİ YAZIYOR (kurucu 10-30, aynen: "HOSTUN ORDAN YAZIYORUZ HOSTA YAZIN GİBİ BİR MESAJ GİTMESİ NASIL MÜMKÜN OLABİLİR";
// "ev sahibini … başka birisiymiş gibi yazmamalı … ev sahibi yazıyor gibi olmalı"; "telefon numarası paylaşılmamış … gidemez kesinlikle arkada
// dönen sistemle ilgili belli edilemez"; taksi / otel / komşu işletme için "onları arayın" … "bence değil riskli bir durum"). SAF: DB / ağ yok.
//
// Misafire giden metin ev sahibinin ağzından yazılır. Gönderilecek metinde (ev sahibine başvurma cümleleri `host-contact-filler.ts`
// tarafından ÇIKARILDIKTAN sonra) şu üçünden biri kalırsa cevabın TAMAMI ev sahibine kalır (kapı ayrıntı kodu `reply_host_voice`):
//   · host_third_person — ev sahibinden üçüncü kişi olarak söz ("Ev sahibiniz yan dairede oturuyor", "Your host is very helpful",
//     "Mesajınız kaydedildi; ev sahibiniz görebilir", "Ev sahibinize yazmanıza gerek yok"). "Ev sahibiniz olarak …" (kendi sesi) serbest.
//   · internal_system — arka plan / kayıt anlatımı ("Telefon numarası paylaşılmamış", "No phone number has been provided").
//   · third_party_referral — misafiri üçüncü taraf işletmeyi aramaya / ona başvurmaya göndermek ("Lale Taksi'yi arayabilirsiniz",
//     "Just ask them at the front desk"). Ev sahibinin kendi hizmeti istemde önerilir (bilgi tabanında yazıyorsa); acil numara bu kuralın
//     konusu değil (`hasEmergencyCallDirective` ayrı tutar).
// Yön YALNIZ TUTMAK. Bu bir KOD YEDEĞİDİR (yaygın biçimler, yedi dil); anlamla karar kıdemli okuyucunun işidir. Kalıplar başı sabit sözcükle
// başlar, aralıklar sınırlı — doğrusal (`host-voice-guard-cost.test.ts`).
// ---------------------------------------------------------------------------

export type HostVoiceViolation = "host_third_person" | "internal_system" | "third_party_referral";

/** VARSAYILAN AÇIK (kurucu: "kesinlikle gitmez"); acil durdurma `AI_HOST_VOICE_GUARD_DISABLED=1`. */
export function hostVoiceGuardEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.AI_HOST_VOICE_GUARD_DISABLED !== "1";
}

const NL = "(?<![\\p{L}])";
const NR = "(?![\\p{L}])";

/** Ev sahibinin kendi sesi: "Ev sahibiniz olarak", "As your host", "En tant qu'hôte" … — üçüncü kişi değildir. */
const OWN_VOICE = new RegExp(
  `${NL}(?:ev sahibiniz olarak|ev sahibi olarak|as your host|as the host|as your hosts|als ihr gastgeber|als gastgeber|en tant qu['’]h[ôo]te|en tant que votre h[ôo]te|como su anfitri[óo]n|como tu anfitri[óo]n|como anfitri[óo]n|как ваш хозяин|как хозяин|بصفتي (?:المضيف|مضيفك))${NR}`,
  "giu",
);

const HOST_THIRD_PERSON = new RegExp(
  [
    // TR: "ev sahibiniz / ev sahibinize / ev sahibinizin / ev sahibimiz …", "mal / daire sahibi", "ev sahibesi".
    `${NL}(?:ev|mal|daire|mülk) sahib(?:e(?:si|niz)|i(?:niz|miz)?)\\p{L}{0,6}${NR}`,
    // EN: belirleyiciyle ("your host", "the host", "your co-host", "the owner", "the property manager", "the landlord").
    `${NL}(?:your|the|our) (?:co-?hosts?|hosts?|hostess|owners?|property owner|landlord|landlady|property manager|apartment owner)${NR}`,
    // DE
    `${NL}(?:ihr|ihre|ihrem|ihren|ihres|ihrer|der|dem|den|des|die|unser|unsere|unserem|unseren) (?:gastgeber\\p{L}{0,3}|vermieter\\p{L}{0,3}|eigentümer\\p{L}{0,3}|co-gastgeber\\p{L}{0,3})${NR}`,
    // FR: "votre hôte / propriétaire / co-hôte", "l'hôte" (Airbnb Fransızcasında ev sahibi).
    `${NL}(?:votre|vos|notre|nos) (?:h[ôo]tes?|propri[ée]taires?|co-?h[ôo]tes?|bailleur|logeur)${NR}`,
    `${NL}(?:l['’]h[ôo]te|le propri[ée]taire|la propri[ée]taire)${NR}`,
    // ES
    `${NL}(?:su|sus|tu|tus|el|la|nuestro|nuestra) (?:anfitri[óo]n|anfitriona|anfitriones|coanfitri[óo]n|propietari[oa]s?|arrendador\\p{L}{0,2}|casero|casera)${NR}`,
    // RU: "хозяин / хозяйка" ve çekimleri, "владелец", "арендодатель".
    `${NL}(?:хозя(?:ин|ина|ину|ином|ине|йка|йки|йку|йкой|йке|ева|ев)|владел(?:ец|ьца|ьцу|ьцем|ьце)|арендодател\\p{L}{0,3})${NR}`,
    // AR
    `(?:المضيف(?:ة)?|مضيفك|مضيفكم|صاحب (?:الشقة|المكان|العقار|السكن|البيت|المنزل)|المالك)`,
  ].join("|"),
  "iu",
);

/**
 * Arka plan / kayıt anlatımı: bilgi nesnesi + "paylaşılmamış / belirtilmemiş / provided değil" (yedi dil). Nesne şart — "Saç kurutma makinesi
 * sağlanmıyor" / "Towels are not provided" mülk OLGUSUDUR (bilgi nesnesi değil). Koşul eki ("aksi belirtilmemişse") sağ sınırla elenir.
 */
const INFO_NOUN_TR = "(?:bilgi|detay|ayr[ıi]nt[ıi]|numara|telefon|adres|kod|[şs]ifre|saat|fiyat|[üu]cret|e-?posta|mail|isim|ad[ıi]|tarih|konum|link|ba[ğg]lant[ıi])\\p{L}{0,8}";
const INTERNAL_SYSTEM = new RegExp(
  [
    // TR: "<bilgi nesnesi> (henüz) paylaşılmamış / belirtilmemiş / verilmemiş / eklenmemiş / girilmemiş / tanımlanmamış / iletilmemiş".
    `${NL}${INFO_NOUN_TR} (?:(?:\\p{L}{1,20} ){0,2})(?:henüz |hen[üu]z de )?(?:payla[şs][ıi]lm|belirtilm|verilm|eklenm|girilm|tan[ıi]mlanm|iletilm|bildirilm|kaydedilm|yaz[ıi]lm|g[öo]sterilm)(?:a|e)?(?:m[ıiuü][şs]|d[ıiuü]|[ıiuü]yor)(?:t[ıiuü]r|d[ıiuü]r)?(?![\\p{L}]|\\s*(?:se|sa)${NR})`,
    // EN: "(no) <info> (has|have|was|were|is|are) (not|n't) (been) provided / shared / listed / specified / given / added / entered / mentioned / supplied".
    `${NL}(?:information|info|details?|number|phone(?: number)?|address|code|password|time|times|price|fee|email|e-mail|name|date|link|contact)s? (?:(?:has|have|was|were|is|are)(?:n['’]t| not)(?: been)?|(?:has|have) not been|hasn['’]t been|haven['’]t been) (?:provided|shared|listed|specified|given|added|entered|mentioned|supplied|set|stated|indicated)${NR}`,
    `${NL}no (?:information|info|details?|phone number|number|address|code|contact details?) (?:(?:has|have) been|was|were|is) (?:provided|shared|listed|specified|given|added|entered|supplied)${NR}`,
    // DE
    `${NL}(?:telefonnummer|nummer|adresse|code|passwort|angabe\\p{L}{0,2}|information\\p{L}{0,2}|details?) (?:\\p{L}{1,20} ){0,2}(?:wurde|wurden|ist|sind) (?:nicht|noch nicht|keine) (?:angegeben|hinterlegt|mitgeteilt|eingetragen|übermittelt)${NR}`,
    // FR
    `${NL}(?:num[ée]ro|adresse|code|mot de passe|information\\p{L}{0,2}|d[ée]tails?) (?:\\p{L}{1,20} ){0,2}(?:n['’]a|n['’]ont|n['’]est|ne sont) pas (?:encore )?(?:[ée]t[ée] )?(?:fourni|communiqu[ée]|indiqu[ée]|pr[ée]cis[ée]|renseign[ée]|partag[ée])\\p{L}{0,2}${NR}`,
    // ES
    `${NL}no se (?:ha|han) (?:proporcionado|facilitado|indicado|especificado|compartido|registrado)${NR}`,
    // RU: "номер / адрес / информация … не указан(а/о) / не предоставлен"
    `${NL}(?:номер|телефон|адрес|код|пароль|информаци\\p{L}{0,2}|данные|сведения) (?:\\p{L}{1,20} ){0,2}не (?:указан|предоставлен|сообщ[её]н|передан|заполнен)\\p{L}{0,2}${NR}`,
    // AR: "لم يتم تزويد / توفير / تحديد / ذكر / مشاركة"
    `لم (?:يتم|يُتم) (?:تزويد|توفير|تحديد|ذكر|مشاركة|إدخال|ادخال)`,
  ].join("|"),
  "iu",
);

/** Acil servis: kendi kuralı var (`hasEmergencyCallDirective`); bu süzgeç onu üçüncü taraf saymaz. */
const EMERGENCY_PARTY = /(?<![\p{L}\d])(?:112|155|110|911|999|100|101|102|103|ambulans\p{L}*|ambulance|police|polis\p{L}*|itfaiye\p{L}*|fire (?:brigade|department)|emergency|acil|notruf|polizei|feuerwehr|pompiers|urgences|emergencias|polic[íi]a|bomberos|скор\p{L}*|полици\p{L}*|пожарн\p{L}*|الإسعاف|الشرطة|الطوارئ)(?![\p{L}\d])/iu;

/** Üçüncü taraf işletmeye gönderme: işletme sözcüğü + iletişim fiili aynı cümlede, sınırlı aralıkla (iki yön) ya da "call / ask them". */
const BUSINESS_TR =
  "(?:taksi|taxi|otel|hostel|pansiyon|resepsiyon|restoran|lokanta|kafe|cafe|market|bakkal|f[ıi]r[ıi]n|eczane|d[üu]kkan|durak|kiralama|rent ?a ?car|transfer [şs]irketi|kuaf[öo]r|tamirci|çilingir|cilingir|komşu|kom[şs]u i[şs]letme)\\p{L}{0,10}";
const BUSINESS_OTHER =
  "(?:taxi|taxis|cab|uber|hotel|hostel|front desk|reception|receptionist|restaurant|caf[ée]|shop|store|bakery|pharmacy|rental (?:shop|company|office)|car rental|locksmith|the driver|the owner of|their staff|tour (?:company|operator)|rezeption|hotelrezeption|taxizentrale|restaurant|bäckerei|apotheke|vermietung|r[ée]ception|boulangerie|pharmacie|location de|chauffeur|recepci[óo]n|panader[íi]a|farmacia|alquiler|conductor|такси|гостиниц\\p{L}{0,2}|отел\\p{L}{0,2}|ресепшн|ресторан\\p{L}{0,2}|аптек\\p{L}{0,2}|водител\\p{L}{0,2}|прокат\\p{L}{0,2}|تاكسي|الفندق|فندق|الاستقبال|المطعم|الصيدلية|السائق)";
const CONTACT_TR =
  "(?:aray[ıi]n|arayabilirsiniz|aray[ıi]p|ileti[şs]ime ge[çc]in|ileti[şs]ime ge[çc]ebilirsiniz|sorun|sorabilirsiniz|yaz[ıi]n|yazabilirsiniz|mesaj at[ıi]n|mesaj atabilirsiniz|rezervasyon yap[ıi]n|rezervasyon yapabilirsiniz|haber verin|haber verebilirsiniz|danışın|danışabilirsiniz)";
const CONTACT_OTHER =
  "(?:call|phone|ring|contact|text|message|whatsapp|e-?mail|ask|book (?:with|through|via)|reach out to|get in touch with|speak (?:to|with)|talk to|rufen sie|kontaktieren sie|fragen sie|wenden sie sich an|schreiben sie|appelez|contactez|demandez|adressez-vous|[ée]crivez|llame|ll[áa]melos|contacte|pregunte|preg[úu]ntele|escriba|reserve con|позвоните|свяжитесь|спросите|напишите|обратитесь|اتصل|تواصل|اسأل|راسل)";
const THIRD_PARTY_REFERRAL = new RegExp(
  [
    `${NL}${BUSINESS_TR}(?:[^.!?\\n]{0,60}?)${NL}${CONTACT_TR}${NR}`,
    `${NL}${CONTACT_TR}(?:[^.!?\\n]{0,10}?)${NL}${BUSINESS_TR}`,
    `${NL}(?:onlar[ıi]|onlara|kendilerine|kendilerini)(?:[^.!?\\n]{0,40}?)${NL}${CONTACT_TR}${NR}`,
    `${NL}${CONTACT_OTHER}${NR}(?:[^.!?\\n]{0,40}?)${NL}${BUSINESS_OTHER}${NR}`,
    `${NL}${BUSINESS_OTHER}${NR}(?:[^.!?\\n]{0,60}?)${NL}${CONTACT_OTHER}${NR}`,
    `${NL}(?:call|ask|contact|text|message|book with|email) them${NR}`,
  ].join("|"),
  "iu",
);

/** Doğrusal cümle bölücü (uzun metinde karesel iş yok): nokta / ünlem / soru / satır sonu. */
function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n" || ((c === "." || c === "!" || c === "?" || c === "؟") && (i + 1 >= text.length || /\s/u.test(text[i + 1])))) {
      const s = text.slice(start, i + 1).trim();
      if (s) out.push(s);
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** Bir cümlede ev sahibinden üçüncü kişi olarak söz ediliyor mu (kendi sesi kalıpları çıkarılınca). */
function mentionsHostThirdPerson(sentence: string): boolean {
  const own = sentence.replace(OWN_VOICE, " ");
  return HOST_THIRD_PERSON.test(own) || HOST_THIRD_PERSON.test(own.toLocaleLowerCase("tr"));
}

/** Gönderilecek metinde ev sahibinin sesini bozan ilk ihlal (yoksa `null`). Saf, doğrusal. */
export function hostVoiceViolation(reply: string | null | undefined): HostVoiceViolation | null {
  if (!reply || !reply.trim()) return null;
  // Uzun boşluk / sekme dizileri tek boşluğa iner (aralıklı kalıplarda yeniden tarama olmasın); anlam değişmez.
  const text = reply.replace(/[^\S\n]+/gu, " ");
  let third: HostVoiceViolation | null = null;
  for (const s of sentencesOf(text)) {
    const lower = s.toLocaleLowerCase("tr");
    if (mentionsHostThirdPerson(s)) return "host_third_person";
    if (INTERNAL_SYSTEM.test(s) || INTERNAL_SYSTEM.test(lower)) return "internal_system";
    if (!third && !EMERGENCY_PARTY.test(s) && (THIRD_PARTY_REFERRAL.test(s) || THIRD_PARTY_REFERRAL.test(lower))) third = "third_party_referral";
  }
  return third;
}
