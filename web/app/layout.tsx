import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import MatrixRain from "./MatrixRain";
import Providers from "./providers";

export const metadata: Metadata = {
  title: "WA Console",
  description: "Private WhatsApp archive console.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#09090B",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <MatrixRain />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
