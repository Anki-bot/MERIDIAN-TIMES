import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { ExperienceProvider } from "@/lib/context/ExperienceContext";
import { WatchImageBackdrop } from "@/components/ui/WatchImageBackdrop";

export const metadata: Metadata = {
  title: "MERIDIAN WATCHES | A Living Atlas of Haute Horlogerie",
  description:
    "Explore an original spatial dictionary of elite watch maisons, complications, and mechanical terminology.",
  applicationName: "MERIDIAN WATCHES",
  keywords: [
    "watches",
    "haute horlogerie",
    "watch complications",
    "watch dictionary",
  ],
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#101416",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ExperienceProvider>
          <div className="elite-shell">
            <WatchImageBackdrop />
            <div className="cinematic-vignette" />
            {children}
          </div>
        </ExperienceProvider>
      </body>
    </html>
  );
}
