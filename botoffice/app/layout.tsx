import type { Metadata } from "next";
import { Mitr } from "next/font/google";
import "./globals.css";

// self-hosted by next/font at build time: no request to Google while running
const mitr = Mitr({ subsets: ["thai", "latin"], weight: ["300", "400", "500", "600"], display: "swap" });

export const metadata: Metadata = { title: "ออฟฟิศบอท 🏢", description: "ออฟฟิศ 3 มิติของบอทบนเครื่องลุงจืด" };

// theme before the first paint: office.theme = system | light | dark (toolbar button in Hud.tsx)
const THEME = `try { const c = localStorage.getItem("office.theme") || "system";
  document.documentElement.dataset.theme = c === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : c; } catch {}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" suppressHydrationWarning>
      <body className={mitr.className}>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
        {children}
      </body>
    </html>
  );
}
