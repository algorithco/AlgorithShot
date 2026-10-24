// Settings. Every change saves right away; there is no Save button.

import { AlertTriangle, ChevronDown, FolderOpen } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api, errorText, type AppInfo, type HotkeyStatus, type Hotkeys, type Settings } from "../shared/api";
import { HotkeyInput } from "../shared/HotkeyInput";
import { useT, type Key } from "../shared/i18n";
import { useSettings } from "../shared/settings";
import { Segmented, Switch, toast } from "../shared/ui";

export function SettingsPage() {
  const t = useT();
  const settings = useSettings((s) => s.settings)!;
  const update = useSettings((s) => s.update);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<HotkeyStatus[]>([]);
  const [moreKeys, setMoreKeys] = useState(false);

  useEffect(() => {
    api.appInfo().then(setInfo);
    api.hotkeyStatus().then(setStatus);
  }, [settings.hotkeys, settings.saveDir]);

  const save = (patch: Partial<Settings>) =>
    update(patch)
      .then(() => api.hotkeyStatus().then(setStatus))
      .catch((e) => toast({ text: t("common.error", { msg: errorText(e) }), error: true }));

  const setKey = (k: keyof Hotkeys, v: string) => save({ hotkeys: { ...settings.hotkeys, [k]: v } });
  const keyStatus = (key: string) => status.find((s) => s.key === key);
  const printScreenBlocked = info?.printScreenTaken && settings.hotkeys.capture === "PrintScreen";

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const example =
    settings.filePattern
      .replace("{app}", "Telegram")
      .replace("{title}", "Chat")
      .replace("{date}", `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
      .replace("{time}", `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`) +
    `.${settings.format === "jpeg" ? "jpg" : settings.format}`;

  return (
    <div className="page settings">
      <h1 className="page-title display">{t("set.title")}</h1>

      <Section title={t("set.general")}>
        <Row label={t("set.language")}>
          <select className="select" value={settings.language} onChange={(e) => save({ language: e.target.value as Settings["language"] })}>
            <option value="system">{t("set.system")}</option>
            <option value="en">English</option>
            <option value="uz">Oʻzbekcha</option>
            <option value="ru">Русский</option>
          </select>
        </Row>
        <Row label={t("set.theme")}>
          <Segmented
            value={settings.theme}
            onChange={(v) => save({ theme: v })}
            options={[
              { value: "system", label: t("set.system") },
              { value: "light", label: t("set.light") },
              { value: "dark", label: t("set.dark") },
            ]}
          />
        </Row>
        <Row label={t("set.startup")} hint={t("set.startupHint")}>
          <Switch checked={settings.launchAtLogin} onChange={(v) => save({ launchAtLogin: v })} label={t("set.startup")} />
        </Row>
        <Row label={t("setup.reopen")} hint={t("setup.reopenHint")}>
          <button className="btn" onClick={() => { location.hash = "setup"; }}>{t("setup.openSetup")} <span aria-hidden="true">↗</span></button>
        </Row>
      </Section>

      <Section title={t("set.capture")}>
        {printScreenBlocked && (
          <div className="notice">
            <AlertTriangle size={18} />
            <div>
              <strong>{t("set.printScreen.title")}</strong>
              <p>{t("set.printScreen.body")}</p>
              <button className="btn" onClick={() => api.openKeyboardSettings()}>
                {t("set.printScreen.button")}
              </button>
            </div>
          </div>
        )}
        <Row label={t("set.hotkey")}>
          <HotkeyInput value={settings.hotkeys.capture} status={keyStatus(settings.hotkeys.capture)} onChange={(v) => setKey("capture", v)} />
        </Row>
        <Row label={t("set.hotkeyAlt")}>
          <HotkeyInput value={settings.hotkeys.captureAlt} status={keyStatus(settings.hotkeys.captureAlt)} onChange={(v) => setKey("captureAlt", v)} />
        </Row>
        <button className="more" onClick={() => setMoreKeys(!moreKeys)} aria-expanded={moreKeys}>
          <ChevronDown size={15} style={{ transform: moreKeys ? "rotate(180deg)" : undefined }} />
          {t("set.moreHotkeys")}
        </button>
        {moreKeys &&
          (
            [
              ["text", "set.hotkeyText"],
              ["qr", "set.hotkeyQr"],
              ["fullScreen", "set.hotkeyScreen"],
              ["repeat", "set.hotkeyRepeat"],
              ["library", "set.hotkeyLibrary"],
            ] as [keyof Hotkeys, Key][]
          ).map(([k, label]) => (
            <Row key={k} label={t(label)}>
              <HotkeyInput value={settings.hotkeys[k]} status={keyStatus(settings.hotkeys[k])} onChange={(v) => setKey(k, v)} />
            </Row>
          ))}
        <Row label={t("set.snap")}>
          <Switch checked={settings.snap} onChange={(v) => save({ snap: v })} label={t("set.snap")} />
        </Row>
        <Row label={t("set.highlight")} hint={t("setup.highlightHint")}>
          <Switch checked={settings.highlight} onChange={(v) => save({ highlight: v })} label={t("set.highlight")} />
        </Row>
        {settings.highlight && (
          <Row label={t("set.elements")}>
            <Switch checked={settings.elements} onChange={(v) => save({ elements: v })} label={t("set.elements")} />
          </Row>
        )}
      </Section>

      <Section title={t("set.after")}>
        <Row label={t("set.copyAfter")}>
          <Switch checked={settings.copyAfterCapture} onChange={(v) => save({ copyAfterCapture: v })} label={t("set.copyAfter")} />
        </Row>
        <Row label={t("set.showCard")}>
          <Switch checked={settings.showCard} onChange={(v) => save({ showCard: v })} label={t("set.showCard")} />
        </Row>
        {settings.showCard && (
          <Row label={t("set.cardSeconds")}>
            <select className="select" value={settings.cardSeconds} onChange={(e) => save({ cardSeconds: Number(e.target.value) })}>
              {[3, 6, 10, 20].map((s) => (
                <option key={s} value={s}>
                  {t("set.seconds", { n: s })}
                </option>
              ))}
            </select>
          </Row>
        )}
        <Row label={t("set.openEditor")}>
          <Switch checked={settings.openEditor} onChange={(v) => save({ openEditor: v })} label={t("set.openEditor")} />
        </Row>
      </Section>

      <Section title={t("set.saving")}>
        <Row label={t("set.saveAll")} hint={t("set.saveAllHint")}>
          <Switch checked={settings.saveAll} onChange={(v) => save({ saveAll: v })} label={t("set.saveAll")} />
        </Row>
        <Row
          label={t("set.folder")}
          hint={`${info?.saveDir || settings.saveDir || info?.defaultSaveDir || ""} · ${t("set.folderKept")}${info?.saveDirSynced ? ` · ${t("set.folderSynced")}` : ""}`}
        >
          <div className="row-controls">
            <button
              className="btn"
              onClick={async () => {
                const dir = await api.pickFolder();
                if (dir) save({ saveDir: dir });
              }}
            >
              {t("set.change")}
            </button>
            <button className="icon-btn" title={t("set.openFolder")} onClick={() => api.openFolder()}>
              <FolderOpen size={16} />
            </button>
            {settings.saveDir && (
              <button className="btn btn-ghost" onClick={() => save({ saveDir: "" })}>
                {t("set.useDefault")}
              </button>
            )}
          </div>
        </Row>
        <Row label={t("set.pattern")} hint={`${t("set.patternHint")} ${t("set.preview", { name: example })}`}>
          <PatternInput value={settings.filePattern} onSave={(v) => save({ filePattern: v })} />
        </Row>
        <Row label={t("set.format")} hint={t(`set.fmt.${settings.format}` as Key)}>
          <Segmented
            value={settings.format}
            onChange={(v) => save({ format: v })}
            options={[
              { value: "png", label: "PNG" },
              { value: "jpeg", label: "JPEG" },
              { value: "webp", label: "WebP" },
            ]}
          />
        </Row>
        {settings.format !== "png" && (
          <Row label={t("set.quality")}>
            <div className="row-controls">
              <input
                type="range"
                min={40}
                max={100}
                value={settings.format === "jpeg" ? settings.jpegQuality : settings.webpQuality}
                onChange={(e) => save(settings.format === "jpeg" ? { jpegQuality: Number(e.target.value) } : { webpQuality: Number(e.target.value) })}
              />
              <span className="measure quality">{settings.format === "jpeg" ? settings.jpegQuality : settings.webpQuality}</span>
            </div>
          </Row>
        )}
      </Section>

      <Section title={t("set.smart")}>
        <Row label={t("set.indexText")}>
          <Switch checked={settings.indexText} onChange={(v) => save({ indexText: v })} label={t("set.indexText")} />
        </Row>
        <Row label={t("set.privacy")}>
          <Switch checked={settings.privacyCheck} onChange={(v) => save({ privacyCheck: v })} label={t("set.privacy")} />
        </Row>
        <Row label={t("set.autoClean")} hint={t("set.autoCleanHint")}>
          <select className="select" value={settings.autoCleanDays} onChange={(e) => save({ autoCleanDays: Number(e.target.value) })}>
            <option value={0}>{t("set.autoCleanOff")}</option>
            {[30, 60, 90, 180].map((d) => (
              <option key={d} value={d}>
                {t("set.autoCleanDays", { n: d })}
              </option>
            ))}
          </select>
        </Row>
      </Section>

      <Section title={t("set.about")}>
        <p className="about">
          <span className="display">{t("app.name")}</span> · {t("set.version", { v: info?.version ?? "" })}
          <br />
          {t("set.offline")}
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="set-section">
      <h2 className="edge set-heading">{title}</h2>
      <div className="set-card">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <div>{label}</div>
        {hint && <div className="set-hint">{hint}</div>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function PatternInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="input"
      style={{ width: 240 }}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() && text !== value && onSave(text)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      spellCheck={false}
    />
  );
}
