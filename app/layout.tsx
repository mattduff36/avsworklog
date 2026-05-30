import type { Viewport } from "next";
import { Inter } from "next/font/google";
import { AppProviders } from "@/lib/providers/app-providers";
import "./globals.css";

// Force dynamic rendering to prevent build-time static generation errors
export const dynamic = 'force-dynamic';

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const appIcon192 = "/icon-avs-yellow-20260529-192x192.png";
const appIcon512 = "/icon-avs-yellow-20260529-512x512.png";
const appTitle = "Squires - A&V Squires Plant Co. Ltd.";
const appDescription = "Digital forms management system for timesheets and van inspections";
const appleTouchIcon = "/apple-touch-icon-avs-yellow-20260529.png";
const appleTouchIcon180 = "/apple-touch-icon-avs-yellow-20260529-180x180.png";
const appleTouchIcon152 = "/apple-touch-icon-avs-yellow-20260529-152x152.png";
const appleTouchIcon167 = "/apple-touch-icon-avs-yellow-20260529-167x167.png";
const appleTouchIcon120 = "/apple-touch-icon-120x120.png";
const appleTouchIconPrecomposed = "/apple-touch-icon-precomposed.png";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const shouldLoadAnalytics = process.env.NODE_ENV === 'production' && process.env.VERCEL === '1';

  return (
    <html
      lang="en"
      className="dark"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      style={{ colorScheme: 'dark' }}
    >
      <head>
        <title>{appTitle}</title>
        <meta name="description" content={appDescription} />
        <meta name="color-scheme" content="dark" />
        <meta name="application-name" content="Squires" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Squires" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="icon" href={appIcon192} sizes="192x192" type="image/png" />
        <link rel="icon" href={appIcon512} sizes="512x512" type="image/png" />
        <link rel="apple-touch-icon" href={appleTouchIcon} sizes="180x180" type="image/png" />
        <link rel="apple-touch-icon" href={appleTouchIcon180} sizes="180x180" type="image/png" />
        <link rel="apple-touch-icon" href={appleTouchIcon152} sizes="152x152" type="image/png" />
        <link rel="apple-touch-icon" href={appleTouchIcon167} sizes="167x167" type="image/png" />
        <link rel="apple-touch-icon" href={appleTouchIcon120} sizes="120x120" type="image/png" />
        <link rel="apple-touch-icon-precomposed" href={appleTouchIconPrecomposed} sizes="180x180" type="image/png" />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <AppProviders shouldLoadAnalytics={shouldLoadAnalytics}>{children}</AppProviders>
      </body>
    </html>
  );
}
