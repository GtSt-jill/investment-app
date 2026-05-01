import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Market Technical Signals",
  description: "Alpaca market data based technical analysis dashboard for category-based stock watchlists."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
