import { useEffect } from "react";
import { useSettings } from "./settings";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function apply(theme: string | undefined) {
  const resolved = theme === "light" || theme === "dark" ? theme : darkQuery.matches ? "dark" : "light";
  document.documentElement.dataset.theme = resolved;
}

/** Puts `data-theme="light|dark"` on <html>, following the setting and Windows. */
export function useTheme() {
  const theme = useSettings((s) => s.settings?.theme);
  useEffect(() => {
    apply(theme);
    const onChange = () => apply(theme);
    darkQuery.addEventListener("change", onChange);
    return () => darkQuery.removeEventListener("change", onChange);
  }, [theme]);
}
