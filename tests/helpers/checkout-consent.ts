// Ödeme onayı rotasının istediği üç açık onay (kurucu 11-13, `src/lib/billing/consent-copy.ts`). Rotayı çağıran testler gövdeye bunu
// ekler; eksik onayın reddini sınayan test bilerek EKLEMEZ (`billing-consent-route.test.ts`).
export const CHECKOUT_CONSENT_FLAGS = {
  preInfoConfirmed: true,
  contractAccepted: true,
  immediateStartConsent: true,
} as const;
