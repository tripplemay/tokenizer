"use client";

import { useTranslations } from "next-intl";

const Footer = () => {
  const t = useTranslations();
  return (
    <div className="flex w-full flex-col items-center justify-between gap-2 px-1 pb-6 pt-3 text-xs text-gray-500 lg:px-8 xl:flex-row">
      <p>{t("footer.copyright", { year: new Date().getFullYear() })}</p>
      <p className="font-mono">
        <a
          href="https://github.com/tripplemay/tokenizer"
          target="_blank"
          rel="noreferrer"
          className="hover:text-brand-500 hover:underline"
        >
          github.com/tripplemay/tokenizer
        </a>
      </p>
    </div>
  );
};

export default Footer;
