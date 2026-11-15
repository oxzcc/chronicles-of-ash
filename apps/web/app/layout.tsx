import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Хроники Пепла",
  description: "Тёмное фэнтези, где историю пишет ИИ-мастер, а исход решают кубики.",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
