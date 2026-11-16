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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400;0,500;1,400&family=Alegreya+Sans:wght@400;500;700&family=Cormorant+Garamond:wght@600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
