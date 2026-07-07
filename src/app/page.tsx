export default function HomePage() {
  return (
    <div className="page">
      <section>
        <p className="eyebrow">Büyük Agent Sistemi</p>
        <h1>Misafir mesajından operasyona giden kontrollü agent katmanı</h1>
        <p className="muted">
          Bu branch Lixus AI için büyük agent sisteminin ilk omurgasını ekler: LiteLLM
          gateway, görev çıkarma, risk/onay kapısı ve operasyon raporu agentları.
        </p>
      </section>

      <div className="grid two">
        <div className="card">
          <h2>Görev Agentı</h2>
          <p className="muted">
            Misafir mesajından temizlik, bakım, check-in ve şikayet görevlerini çıkarır.
            Riskli konularda misafire otomatik cevap göndermeden insan onayına düşer.
          </p>
        </div>
        <div className="card">
          <h2>Rapor Agentı</h2>
          <p className="muted">
            Görev, mesaj ve risk metriklerinden haftalık operasyon içgörüsü üretir.
            Mülk bazlı tekrar eden sorunları rapora taşır.
          </p>
        </div>
      </div>
    </div>
  );
}
