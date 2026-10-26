import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "AI-CHART.PRO — Research Terminal",
  description: "Biểu đồ Binance trực tiếp với lớp phủ mẫu hình AI",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body
        className="h-screen w-screen overflow-hidden antialiased"
        style={{
          fontFamily: "var(--font-plex-sans), 'IBM Plex Sans', sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
