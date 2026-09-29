import type { Metadata } from "next";
import "./globals.css";
import { brandAssets } from "@/lib/brand";

export const metadata: Metadata = {
  title: "JiawenLex · 雅思备考工作台",
  description: "今日计划、四科练习、词汇复习与个人进度。",
  icons: {
    icon: [
      { url: brandAssets.favicon, sizes: "32x32", type: "image/png" },
      { url: brandAssets.icon, sizes: "192x192", type: "image/png" },
    ],
    shortcut: brandAssets.favicon,
    apple: { url: brandAssets.apple, sizes: "180x180", type: "image/png" },
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
