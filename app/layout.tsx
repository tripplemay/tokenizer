import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tokenizer",
  description: "Coding token usage tracker"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto min-h-screen max-w-7xl px-6 py-8">
          <nav className="mb-8 flex items-center justify-between">
            <a href="/" className="text-2xl font-semibold tracking-tight">Tokenizer</a>
            <div className="flex gap-4 text-sm text-slate-300">
              <a href="/">Overview</a>
              <a href="/events">Events</a>
            </div>
          </nav>
          {children}
        </main>
      </body>
    </html>
  );
}
