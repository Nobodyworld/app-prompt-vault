import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { translations, type Locale, type TranslationKey, type TranslationValue } from "./translations";

interface I18nContextValue {
    locale: Locale;
    setLocale: (next: Locale) => void;
    t: (key: TranslationKey, params?: Record<string, string | number | undefined>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "prompt-vault-locale";

function normalizeLocale(raw: string | undefined): Locale {
    const candidate = (raw ?? "").toLowerCase();
    if (candidate.startsWith("es")) return "es";
    return "en";
}

function resolveTranslation(value: TranslationValue, params?: Record<string, string | number | undefined>): string {
    if (typeof value === "function") {
        return value(params ?? {});
    }
    return value;
}

export function I18nProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
    const initialLocale = useMemo(() => {
        try {
            const stored = window.localStorage.getItem(STORAGE_KEY);
            if (stored) return normalizeLocale(stored);
        } catch {
            // ignore
        }
        return normalizeLocale(typeof navigator !== "undefined" ? navigator.language : undefined);
    }, []);

    const [locale, setLocaleState] = useState<Locale>(initialLocale);

    const setLocale = useCallback((next: Locale) => {
        setLocaleState(next);
        try {
            window.localStorage.setItem(STORAGE_KEY, next);
        } catch {
            // ignore
        }
    }, []);

    const t = useCallback(
        (key: TranslationKey, params?: Record<string, string | number | undefined>) => {
            const dict = translations[locale];
            const fallback = translations.en;
            const value = dict[key] ?? fallback[key];
            return resolveTranslation(value, params);
        },
        [locale]
    );

    const value = useMemo<I18nContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
    const ctx = useContext(I18nContext);
    if (!ctx) {
        throw new Error("useI18n must be used within an I18nProvider");
    }
    return ctx;
}
