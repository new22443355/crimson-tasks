import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ORDO — Дневник дел",
  description: "Личный дневник задач. Планируйте, отмечайте сделанное и сохраняйте историю своих шагов.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
