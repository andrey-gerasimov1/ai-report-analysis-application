import type { Metadata } from "next";
import "@fontsource-variable/lexend-deca/wght.css";
import "@fontsource-variable/open-sans/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Report Analysis Application",
  description: "A permission-aware, citation-first research assistant demonstration.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
