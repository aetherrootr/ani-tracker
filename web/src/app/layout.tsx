import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import "./globals.css";

import { MobileScrollRestorer } from "@/components/layout/MobileScrollRestorer";
import { ServiceWorkerRegistrar } from "@/components/layout/ServiceWorkerRegistrar";
import { translations } from "@/i18n";

import { Providers } from "./providers";

export const metadata: Metadata = {
  applicationName: "Ani Tracker",
  title: "Ani Tracker",
  description: "Anime tracking progress management Web App",
  appleWebApp: {
    capable: true,
    title: "Ani Tracker",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
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
            <ServiceWorkerRegistrar />
            <MobileScrollRestorer />
            {children}
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
