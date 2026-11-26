// YAPRAK modül (hiçbir şey içe aktarmaz): anlama katmanının istek başına ilişki işareti — şema (`understanding-schema.ts`) ve karar
// (`relation.ts`) AYNI kapalı kümeyi okur. Ayrı dosya: şema modülü getirme sözlüğünü ve kelime ağını içe çekmesin.
export const ITEM_RELATIONS = ["own_topic", "fix_request", "follow_up", "unclear"] as const;
export type ItemRelation = (typeof ITEM_RELATIONS)[number];
