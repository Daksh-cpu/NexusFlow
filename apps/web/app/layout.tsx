import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NexusFlow | Autonomous Multi-Agent Research",
  description: "Elite financial and technical research powered by autonomous agents.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
