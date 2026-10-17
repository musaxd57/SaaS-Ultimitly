// ---------------------------------------------------------------------------
// DEMO HESABI — sabitler (Airbnb başvurusu kapısı: "demo tenant, 10–15 örnek mülk").
//
// Her satırın kimliği `lxdemo-` ile başlar: veritabanında bir satırın SENTETİK olduğu kimliğinden
// okunur ve silme/yenileme yalnız bu org'a dokunur. Kimlikler depolama anahtarı kuralına uyar
// (`[a-zA-Z0-9-]`, alt çizgi YOK — görev fotoğrafı yüklemesi alt çizgili kimlikte kırılır).
// ---------------------------------------------------------------------------

export const DEMO_ORG_ID = "lxdemo-org";
export const DEMO_ID_PREFIX = "lxdemo-";
/** Airbnb inceleme ekibine verilecek giriş adresi (yönetici rolü; sahip DEĞİL). */
export const DEMO_LOGIN_EMAIL = "demo@lixusai.com";
export const DEMO_TIMEZONE = "Europe/Istanbul";
/** Deterministik üretim tohumu — aynı `now` + aynı tohum = birebir aynı veri kümesi. */
export const DEMO_SEED = 20260924;
/** Rezervasyon penceresi, bugünden gün olarak. */
export const DEMO_PAST_DAYS = 120;
export const DEMO_FUTURE_DAYS = 75;
/** Mülk başına en fazla iptal: üç iptal aynı mülkte "tekrar eden iptal" örüntüsü üretirdi. */
export const DEMO_MAX_CANCELLED_PER_PROPERTY = 2;
/** Demo şifresinin en kısa uzunluğu (şifre yalnız ortam değişkeninden gelir, koda yazılmaz). */
export const DEMO_PASSWORD_MIN_LENGTH = 20;

/**
 * Bu org demo (Airbnb inceleme) hesabı mı? Görüntü kararları için TEK kaynak: örnek veri bandı,
 * "kanalınızı bağlayın" dürtülerinin gizlenmesi, gerçek kullanım metriklerinden dışlama.
 * Kimlik öneki kuralı (`lxdemo-`) yazma tarafında zorlanır; burada yalnız org kimliğine bakılır
 * (kolon/migration YOK — tek demo org'u var).
 */
export function isDemoOrg(organizationId: string | null | undefined): boolean {
  return organizationId === DEMO_ORG_ID;
}
