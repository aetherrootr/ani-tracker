import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import "./globals.css";

import { MobileScrollRestorer } from "@/components/layout/MobileScrollRestorer";
import { translations } from "@/i18n";

import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Ani Tracker",
  description: "Anime tracking progress management Web App",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full bg-background text-foreground">
        <NextIntlClientProvider locale="zh-CN" messages={translations["zh-CN"]}>
          <Providers>
            <MobileScrollRestorer />
            {children}
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
