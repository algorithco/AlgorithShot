import { AppWindow } from "lucide-react";
import { useState } from "react";
import { appIconUrl } from "../shared/api";

/** Native Windows artwork; a neutral app symbol only if the app is unavailable. */
export function AppIcon({ app, revision }: { app: string; revision: number }) {
  const src = appIconUrl(app, revision);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return (
    <span className="app-icon" aria-hidden="true">
      {failedSrc === src ? (
        <AppWindow size={18} />
      ) : (
        <img src={src} width={18} height={18} alt="" draggable={false} onError={() => setFailedSrc(src)} />
      )}
    </span>
  );
}
