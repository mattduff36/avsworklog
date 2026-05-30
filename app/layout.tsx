import type { Metadata, Viewport } from "next";
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
const appleTouchIcon = "/apple-touch-icon-avs-yellow-20260529.png";
const appleTouchIcon180 = "/apple-touch-icon-avs-yellow-20260529-180x180.png";
const appleTouchIcon152 = "/apple-touch-icon-avs-yellow-20260529-152x152.png";
const appleTouchIcon167 = "/apple-touch-icon-avs-yellow-20260529-167x167.png";
const appleTouchIcon120 = "/apple-touch-icon-120x120.png";
const appleTouchIconPrecomposed = "/apple-touch-icon-precomposed.png";

export const metadata: Metadata = {
  title: "Squires - A&V Squires Plant Co. Ltd.",
  description: "Digital forms management system for timesheets and van inspections",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: appIcon192, sizes: "192x192", type: "image/png" },
      { url: appIcon512, sizes: "512x512", type: "image/png" },
      { url: appIcon192, sizes: "192x192", type: "image/png", media: "(prefers-color-scheme: light)" },
      { url: appIcon192, sizes: "192x192", type: "image/png", media: "(prefers-color-scheme: dark)" },
    ],
    apple: [
      { url: appleTouchIcon, sizes: "180x180", type: "image/png" },
      { url: appleTouchIcon180, sizes: "180x180", type: "image/png" },
      { url: appleTouchIcon152, sizes: "152x152", type: "image/png" },
      { url: appleTouchIcon167, sizes: "167x167", type: "image/png" },
      { url: appleTouchIcon120, sizes: "120x120", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Squires",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
    "mobile-web-app-capable": "yes",
  },
};

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
        <meta name="color-scheme" content="dark" />
        <link rel="apple-touch-icon" sizes="180x180" href={appleTouchIcon} />
        <link rel="apple-touch-icon" sizes="180x180" href={appleTouchIcon180} />
        <link rel="apple-touch-icon" sizes="152x152" href={appleTouchIcon152} />
        <link rel="apple-touch-icon" sizes="167x167" href={appleTouchIcon167} />
        <link rel="apple-touch-icon" sizes="120x120" href={appleTouchIcon120} />
        <link rel="apple-touch-icon-precomposed" sizes="180x180" href={appleTouchIconPrecomposed} />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <AppProviders shouldLoadAnalytics={shouldLoadAnalytics}>{children}</AppProviders>
      </body>
    </html>
  );
}
