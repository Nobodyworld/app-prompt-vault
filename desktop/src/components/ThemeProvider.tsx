/**
 * ThemeProvider - Wraps @nw/ui-theme for Prompt Vault
 *
 * This component provides backwards compatibility with the existing theme API
 * while using the shared Nobodyworld OS theme system under the hood.
 */

import React, { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { applyTheme } from "../lib/platform-ui";

type Theme = "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const LegacyThemeContext = createContext<ThemeContextType | undefined>(
  undefined,
);

/**
 * Hook for accessing theme context (backwards compatible API)
 */
export function useTheme(): ThemeContextType {
  const context = useContext(LegacyThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Theme provider using shared @nw/ui-theme with backwards compatible API
 */
export function ThemeProvider({
  children,
}: ThemeProviderProps): React.JSX.Element {
  const [theme, setTheme] = React.useState<Theme>(() => {
    try {
      const stored = window.localStorage.getItem("prompt-vault-theme");
      return stored === "light" || stored === "dark" ? stored : "dark";
    } catch {
      return "dark";
    }
  });

  React.useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem("prompt-vault-theme", theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggleTheme = React.useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return (
    <LegacyThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </LegacyThemeContext.Provider>
  );
}
