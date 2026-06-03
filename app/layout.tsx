import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EDG3 — Your AI Chief of Staff",
  description: "A proactive AI that calls you every morning with a personalized strategic briefing.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
