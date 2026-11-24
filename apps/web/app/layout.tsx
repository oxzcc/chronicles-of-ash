import type { ReactNode } from "react";
import "./globals.css";
import "./arkham.css";

export const metadata = {
  title: "Таинственные дела в Аркхэме",
  description: "Мистический детектив, 1926 год: улики, свидетели и то, чего лучше не знать.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
