import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "观澜校园墙",
  description: "校园资讯、日常分享、失物招领、表白与树洞，都在观澜校园墙。",
};

export const viewport: Viewport = { themeColor: "#f2eee4" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
