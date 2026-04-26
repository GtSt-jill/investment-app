import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Semiconductor Technical Signals",
  description: "Alpaca market data based technical analysis dashboard for major semiconductor stocks."
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
