import "./globals.css";
import "@/styles/App.css";
import "@/styles/Contact.css";
import "@/styles/MiniCalendar.css";
import "@/styles/index.css";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { AdminShell } from "./admin-shell";

export const metadata: Metadata = {
  title: "Tokenizer",
  description: "Coding token usage tracker"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body id="root">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AdminShell>{children}</AdminShell>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
