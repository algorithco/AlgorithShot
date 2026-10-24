// Explicit development-only artwork preview. Never included in the desktop build.
import { useState } from "react";
import type { CSSProperties } from "react";
import { LoadingScreen } from "../library/LoadingScreen";
import type { StartupStage } from "../library/startup";
import { useT } from "../shared/i18n";

export function LoadingPreview() {
  const t = useT();
  const params = new URLSearchParams(location.search);
  const mode = params.get("loading-preview");
  const [failed, setFailed] = useState(mode === "error");
  const stage: StartupStage = mode === "settings" || mode === "ready" ? mode : "workspace";
  if (params.get("size") === "compact") {
    const childUrl = new URL(location.href);
    childUrl.searchParams.delete("size");
    return <div style={{ display: "grid", placeItems: "center", height: "100vh", background: "#23231f" }}><iframe title="Compact loading preview" src={childUrl.href} width="390" height="560" style={{ border: "1px solid #44443b" }} /></div>;
  }
  const frame = Number(params.get("frame"));
  const previewStyle = params.has("frame") && Number.isFinite(frame)
    ? { "--preview-time": `${-Math.max(0, frame)}ms` } as CSSProperties
    : undefined;
  return (
    <div className={previewStyle ? "loading-frame-preview" : undefined} style={previewStyle}>
      {previewStyle && <style>{`.loading-frame-preview .startup-center { animation: none; } .loading-frame-preview .startup-scene * { animation-delay: var(--preview-time) !important; animation-play-state: paused !important; }`}</style>}
      <LoadingScreen stage={stage} error={failed ? t("startup.timeout") : null} onRetry={() => setFailed(false)} />
    </div>
  );
}
