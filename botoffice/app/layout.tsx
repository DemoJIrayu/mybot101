import type { Metadata } from "next";
import { Mitr } from "next/font/google";
import "./globals.css";

// self-hosted by next/font at build time: no request to Google while running
const mitr = Mitr({ subsets: ["thai", "latin"], weight: ["300", "400", "500", "600"], display: "swap" });

export const metadata: Metadata = { title: "ออฟฟิศบอท 🏢", description: "ออฟฟิศ 3 มิติของบอทบนเครื่องลุงจืด" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className={mitr.className}>{children}</body>
    </html>
  );
}
