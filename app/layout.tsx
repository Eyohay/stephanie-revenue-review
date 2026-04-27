import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stephanie Revenue Review",
  description: "Client revenue and pilot health for Stephanie.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
