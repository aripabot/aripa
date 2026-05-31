import type { Metadata } from "next";
import type * as React from "react";

import "@/styles.css";

export const metadata: Metadata = {
  title: "Aripa Dashboard",
  description: "Local dashboard for Aripa runtime settings, logs, and updates.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
