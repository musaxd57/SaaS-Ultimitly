// ---------------------------------------------------------------------------
// Görev panosunun kart sorgusu (yaprak — sayfa ve test AYNI sorguyu koşar).
// Tur 6 T6-SU-2 (11-05, ölçüldü): kart "son not"u yalnız EN SON güncelleme satırından okuyordu; her durum değişikliği / fotoğraf AYRI
// satır açtığı için not, durum değişir değişmez ya da fotoğraf eklenince panodan kayboluyordu (fotoğrafın aynı sınıf hatası daha önce
// düzeltilmişti: fotoğraf ayrı sorgudan). Not artık NOTU OLAN en son satırdan.
// ---------------------------------------------------------------------------

export const TASK_BOARD_INCLUDE = {
  property: { select: { name: true } },
  assignedTo: { select: { name: true } },
  updates: {
    where: { note: { not: null } },
    select: { photoUrl: true, note: true, createdAt: true },
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: 1,
  },
};
