import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mira Evaluation",
  description: "Mira Agent 评估实验配置与运行",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh">
      <body className="antialiased min-h-screen">{children}</body>
    </html>
  );
}
