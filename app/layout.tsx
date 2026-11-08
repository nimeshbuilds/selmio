import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Selmio — Know what fits.",
  description:
    "A little more breathing room. An open-source, local budgeting app that helps you understand what a spending decision changes.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
