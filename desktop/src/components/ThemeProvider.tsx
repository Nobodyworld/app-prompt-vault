/**
 * ThemeProvider - Wraps @nw/ui-theme for Prompt Vault
 *
 * This component provides backwards compatibility with the existing theme API
 * while using the shared Nobodyworld OS theme system under the hood.
 */

import React, { createContext, useContext } from "react";
import type { ReactNode } from "react";
import {
  NwThemeProvider,
  useNwTheme,
  type ThemeMode,
} from "../lib/platform-ui";

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
 * Inner component that bridges the shared theme to legacy API
 */
function ThemeBridge({ children }: { children: ReactNode }): React.JSX.Element {
  const { resolvedMode, setMode } = useNwTheme();

  const toggleTheme = (): void => {
    const newMode: ThemeMode = resolvedMode === "dark" ? "light" : "dark";
    setMode(newMode);
  };

  return (
    <LegacyThemeContext.Provider value={{ theme: resolvedMode, toggleTheme }}>
      {children}
    </LegacyThemeContext.Provider>
  );
}

/**
 * Theme provider using shared @nw/ui-theme with backwards compatible API
 */
export function ThemeProvider({
  children,
}: ThemeProviderProps): React.JSX.Element {
  return (
    <NwThemeProvider defaultMode="dark" storageKey="prompt-vault-theme">
      <ThemeBridge>{children}</ThemeBridge>
    </NwThemeProvider>
  );
}
