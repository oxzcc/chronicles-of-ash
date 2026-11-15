import type { ReactNode } from "react";

export const metadata = {
  title: "Хроники Пепла",
  description: "Тёмное фэнтези, где историю пишет ИИ-мастер, а исход решают кубики.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body style={{ margin: 0, background: "#15110e", color: "#e8dcc8", fontFamily: "Georgia, 'Times New Roman', serif" }}>{children}</body>
    </html>
  );
}
