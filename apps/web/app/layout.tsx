import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "ExamForge Operations",
  description: "Enterprise examination scheduling operations console",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
