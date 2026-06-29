import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Repo → Resume",
  description:
    "Turn any GitHub repository into resume bullets, interview talking points, a tech stack, and matching job titles.",
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
