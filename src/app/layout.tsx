import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Lixus AI Agent System",
  description: "Large agent system branch for Lixus AI hospitality operations."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div>
              <p className="eyebrow">Lixus AI</p>
              <h1>Agent Ops</h1>
            </div>
            <nav>
              <a href="/">Genel Bakış</a>
              <a href="/tasks">Görevler</a>
              <a href="/reports">Raporlar</a>
            </nav>
          </aside>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
