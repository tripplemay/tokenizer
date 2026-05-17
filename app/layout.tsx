import "./globals.css";
import "@/styles/App.css";
import "@/styles/Contact.css";
import "@/styles/MiniCalendar.css";
import "@/styles/index.css";
import type { Metadata } from "next";
import { AdminShell } from "./admin-shell";

export const metadata: Metadata = {
  title: "Tokenizer",
  description: "Coding token usage tracker"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body id="root">
        <AdminShell>{children}</AdminShell>
      </body>
    </html>
  );
}
