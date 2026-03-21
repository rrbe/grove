import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getThemeMode, setThemeMode as persistThemeMode } from "./api";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.setAttribute("data-theme", resolved);
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "system",
  resolved: "light",
  setMode: () => {},
});

const VALID_MODES: ThemeMode[] = ["light", "dark", "system"];

function parseMode(raw: string | null): ThemeMode {
  return raw && VALID_MODES.includes(raw as ThemeMode) ? (raw as ThemeMode) : "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    return parseMode(localStorage.getItem("grove-theme"));
  });
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(mode));

  // Load persisted theme from backend on mount
  useEffect(() => {
    getThemeMode().then((stored) => {
      const m = parseMode(stored);
      setModeState(m);
      localStorage.setItem("grove-theme", m);
      const r = resolveTheme(m);
      setResolved(r);
      applyTheme(r);
    }).catch(() => {});
  }, []);

  // Listen to system preference changes when mode is "system"
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      const r: ResolvedTheme = e.matches ? "dark" : "light";
      setResolved(r);
      applyTheme(r);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  // Apply theme whenever mode changes
  useEffect(() => {
    const r = resolveTheme(mode);
    setResolved(r);
    applyTheme(r);
  }, [mode]);

  const setMode = (newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem("grove-theme", newMode);
    persistThemeMode(newMode).catch(() => {});
  };

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
