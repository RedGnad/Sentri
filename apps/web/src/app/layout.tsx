import type { Metadata } from "next";
import { Instrument_Serif, JetBrains_Mono, Inter_Tight } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Navbar } from "@/components/navbar";
import { NavProgress } from "@/components/nav-progress";
import { Toaster } from "sonner";

const serif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

const sans = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sentri — Autonomous Treasury on 0G",
  description: "Your AI treasurer. Private strategy, verifiable results.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">
        <Providers>
          <NavProgress />
          <Navbar />
          <main className="max-w-[1200px] mx-auto px-6 sm:px-8 lg:px-12 py-12 relative">
            {children}
          </main>
          <Toaster theme="dark" position="bottom-right" />
        </Providers>
      </body>
    </html>
  );
}
