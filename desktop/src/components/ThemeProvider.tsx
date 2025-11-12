import React, { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";

type Theme = "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps): React.JSX.Element {
  const [theme, setTheme] = useState<Theme>(() => {
    // Load theme from localStorage or default to dark
    const saved = localStorage.getItem("prompt-vault-theme") as Theme;
    return saved || "dark";
  });

  useEffect(() => {
    // Save theme to localStorage
    localStorage.setItem("prompt-vault-theme", theme);

    // Apply theme to document
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = (): void => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
