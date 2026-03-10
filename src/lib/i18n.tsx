import { createContext, useContext, useState, type ReactNode } from "react";
import type { Translations } from "../locales/types";
import { zhCN } from "../locales/zh-CN";
import { en } from "../locales/en";

export type Locale = "zh-CN" | "en";
export type { Translations };

const locales: Record<Locale, Translations> = {
  "zh-CN": zhCN,
  en,
};

type I18nContextValue = {
  locale: Locale;
  t: Translations;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue>({
  locale: "zh-CN",
  t: zhCN,
  setLocale: () => {},
});

export function I18nProvider({
  children,
  defaultLocale = "zh-CN",
}: {
  children: ReactNode;
  defaultLocale?: Locale;
}) {
  const [locale, setLocale] = useState<Locale>(defaultLocale);
  const t = locales[locale];

  return (
    <I18nContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
