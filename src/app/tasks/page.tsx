import { AnalyzeMessageForm } from "./task-agent-form";
import { OperationPlanPanel } from "./operation-plan-panel";

const exampleTasks = [
  {
    title: "Klima arızası kontrolü",
    property: "Galata Loft",
    priority: "URGENT",
    risk: "HIGH",
    source: "Misafir: Klima çalışmıyor, çocuk var ev çok sıcak."
  },
  {
    title: "Eksik havlu teslimi",
    property: "Moda Studio",
    priority: "MEDIUM",
    risk: "LOW",
    source: "Misafir: Banyoda sadece bir havlu var."
  },
  {
    title: "İade talebi yönetici onayı",
    property: "Karaköy Suite",
    priority: "HIGH",
    risk: "HIGH",
    source: "Misafir: İptal etmek istiyorum, paramı geri verin."
  }
];

export default function TasksPage() {
  return (
    <div className="page">
      <section>
        <p className="eyebrow">Görevler</p>
        <h1>Misafir mesajından operasyon görevi çıkar</h1>
        <p className="muted">
          Büyük agent sistemi burada başlar: mesajı anlar, görevi önerir, riskli cevapları
          insan onayına alır ve SLA/ekip önerisi üretir.
        </p>
      </section>

      <div className="grid two">
        <AnalyzeMessageForm />
        <OperationPlanPanel />
      </div>

      <div className="grid">
        <div className="card">
          <h2>Önerilen Görev Kuyruğu</h2>
          <div className="grid">
            {exampleTasks.map((task) => (
              <article className="card" key={task.title}>
                <div className={`badge ${task.risk.toLowerCase()}`}>{task.risk}</div>
                <h3>{task.title}</h3>
                <p className="muted">{task.property}</p>
                <p>{task.source}</p>
                <p className="muted">Öncelik: {task.priority}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
