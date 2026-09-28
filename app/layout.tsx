import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JiawenLex · 雅思备考工作台",
  description: "今日计划、四科练习、词汇复习与个人进度。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
