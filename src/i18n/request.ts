import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

const SUPPORTED = ["zh-CN", "en"] as const;
type SupportedLocale = (typeof SUPPORTED)[number];
const DEFAULT_LOCALE: SupportedLocale = "zh-CN";

function isSupported(value: string | undefined): value is SupportedLocale {
  return Boolean(value && (SUPPORTED as readonly string[]).includes(value));
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const stored = store.get("NEXT_LOCALE")?.value;
  const locale: SupportedLocale = isSupported(stored) ? stored : DEFAULT_LOCALE;
  const messages = (await import(`../../messages/${locale}.json`)).default;
  return { locale, messages };
});
