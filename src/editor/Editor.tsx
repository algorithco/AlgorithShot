// Placeholder until the editor lands (step 4): shows the image.

import { useEffect } from "react";
import { shotUrl } from "../shared/api";
import { initSettings } from "../shared/settings";
import { useTheme } from "../shared/theme";

const target = new URLSearchParams(location.search).get("target") ?? "";

export function Editor() {
  useTheme();
  useEffect(() => {
    initSettings();
  }, []);
  const [kind, id] = target.split(":");
  const src = kind === "shot" ? shotUrl(`image/${id}`) : shotUrl(`mem/${id}`);
  return (
    <div className="editor-placeholder checker">
      <img src={src} alt="" />
    </div>
  );
}
