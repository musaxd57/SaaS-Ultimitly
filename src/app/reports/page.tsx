import { ReportInsightPanel } from "./report-insight-panel";

const metrics = [
  ["Toplam Mesaj", "428"],
  ["Açılan Görev", "96"],
  ["SLA İhlali", "7"],
  ["Riskli Konuşma", "19"]
];

export default function ReportsPage() {
  return (
    <div className="page">
      <section>
        <p className="eyebrow">Raporlar</p>
        <h1>Operasyon içgörüsü ve AI kalite metrikleri</h1>
        <p className="muted">
          Rapor agentı görev, mesaj ve risk verilerini yönetici diline çevirir. Amaç grafik
          göstermek değil, operasyon kararını kolaylaştırmak.
        </p>
      </section>

      <div className="grid two">
        {metrics.map(([label, value]) => (
          <div className="card" key={label}>
            <p className="muted">{label}</p>
            <div className="metric">{value}</div>
          </div>
        ))}
      </div>

      <ReportInsightPanel />
    </div>
  );
}
