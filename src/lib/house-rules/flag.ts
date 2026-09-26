// ---------------------------------------------------------------------------
// EV KURALLARI KARTI — TEK OKUMA NOKTASI (#188 dilim 2). VARSAYILAN KAPALI: kart ve kayıt rotası yalnız
// `HOUSE_RULES_CARD_ENABLED=1` iken görünür/çalışır. Açma sırası (kurucu 09-26): kart (kurallar girilir) → gölge ölçüm →
// ücretli kör ölçüm → kurucu onayı → karar. Kart açıkken bile yapay zekâ bu kuralları henüz KULLANMAZ (kart bunu söyler).
// Yaprak modül (import yok).
// ---------------------------------------------------------------------------

export function houseRulesCardEnabled(): boolean {
  return process.env.HOUSE_RULES_CARD_ENABLED?.trim() === "1";
}
