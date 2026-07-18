import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import "./globals.css";

import { MobileScrollRestorer } from "@/components/layout/MobileScrollRestorer";
import { ServiceWorkerRegistrar } from "@/components/layout/ServiceWorkerRegistrar";
import { translations } from "@/i18n";
import { appIconUrl, appleTouchIconUrl } from "@/lib/app-branding";

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
      { url: appIconUrl },
    ],
    apple: [
      { url: appleTouchIconUrl, sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f4f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0c12" },
  ],
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
