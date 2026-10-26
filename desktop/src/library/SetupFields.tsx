import { ArrowUpRight, Check, Clipboard, FileImage, FolderOpen, Keyboard, Monitor, Moon, ScanLine, Search, ShieldCheck, Sparkles, Sun, WandSparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { AppInfo, HotkeyStatus, Hotkeys, Settings } from "../shared/api";
import { HotkeyInput } from "../shared/HotkeyInput";
import type { Key, useT } from "../shared/i18n";
import { Keys, Logo, Switch } from "../shared/ui";
import { duplicateShortcuts, setupFilename, type SetupStep } from "./setup";

export type SetupTranslate = ReturnType<typeof useT>;
type Controls = { draft: Settings; patch: (patch: Partial<Settings>) => void; t: SetupTranslate };

export function SetupGroup({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="setup-group"><div className="setup-group-heading"><h2>{title}</h2>{hint && <p>{hint}</p>}</div>{children}</section>;
}

function ToggleRow({ icon, label, hint, checked, onChange }: { icon?: ReactNode; label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="setup-toggle-row">{icon && <span className="setup-row-icon" aria-hidden="true">{icon}</span>}<div><p>{label}</p>{hint && <small>{hint}</small>}</div><Switch label={label} checked={checked} onChange={onChange} /></div>;
}

export function PersonalizeStep({ draft, patch, t }: Controls) {
  return <>
    <SetupGroup title={t("set.language")} hint={t("setup.languageHint")}>
      <div className="setup-language-grid">
        {([
          ["system", "AUTO", t("set.system")], ["en", "EN", "English"], ["uz", "UZ", "Oʻzbekcha"], ["ru", "RU", "Русский"],
        ] as const).map(([language, code, label]) => <button type="button" key={language} className={`setup-choice setup-language${draft.language === language ? " selected" : ""}`} aria-pressed={draft.language === language} onClick={() => patch({ language })}><span className="setup-language-code">{code}</span><strong>{label}</strong><span className="setup-choice-check" aria-hidden="true">{draft.language === language && <Check size={12} />}</span></button>)}
      </div>
    </SetupGroup>
    <SetupGroup title={t("set.theme")} hint={t("setup.themeHint")}>
      <div className="setup-theme-grid">
        {(["light", "dark", "system"] as const).map((theme) => {
          const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
          return <button type="button" key={theme} className={`setup-choice setup-theme${draft.theme === theme ? " selected" : ""}`} aria-pressed={draft.theme === theme} onClick={() => patch({ theme })}><div className="setup-theme-preview" data-mode={theme} aria-hidden="true"><div className="setup-mini-sidebar"><Logo size={14} /><i /><i /><i /></div><div className="setup-mini-content"><span /><div><i /><i /><i /></div><b /></div></div><span className="setup-theme-label"><Icon size={15} />{t(`set.${theme}`)}<span className="setup-choice-check" aria-hidden="true">{draft.theme === theme && <Check size={12} />}</span></span></button>;
        })}
      </div>
    </SetupGroup>
    <div className="setup-card"><ToggleRow icon={<Monitor size={19} />} label={t("set.startup")} hint={t("set.startupHint")} checked={draft.launchAtLogin} onChange={(launchAtLogin) => patch({ launchAtLogin })} /></div>
  </>;
}

export function CaptureStep({ draft, patch, t, info, status, onWindowsSettings }: Controls & { info: AppInfo | null; status: HotkeyStatus[]; onWindowsSettings: () => void }) {
  const keyStatus = (key: string) => status.find((item) => item.key === key);
  const setKey = (key: keyof Hotkeys, value: string) => patch({ hotkeys: { ...draft.hotkeys, [key]: value } });
  const blocked = info?.printScreenTaken && Object.values(draft.hotkeys).some((key) => key.toLowerCase() === "printscreen") && !keyStatus("PrintScreen")?.ok;
  const duplicates = duplicateShortcuts(draft.hotkeys);
  return <>
    <div className="setup-capture-demo"><div className="setup-capture-icon" aria-hidden="true"><ScanLine size={25} /></div><div><small>{t("setup.anyApp")}</small><div>{draft.hotkeys.capture || draft.hotkeys.captureAlt ? <Keys value={draft.hotkeys.capture || draft.hotkeys.captureAlt} /> : <span>{t("setup.captureButton")}</span>}</div></div><span className="setup-demo-arrow" aria-hidden="true">↗</span></div>
    <SetupGroup title={t("setup.mainShortcuts")} hint={t("setup.keysApplyOnSave")}>
      <div className="setup-card">
        {([ ["capture", "set.hotkey"], ["captureAlt", "set.hotkeyAlt"] ] as [keyof Hotkeys, Key][]).map(([key, label]) => <div className="setup-key-row" key={key}><label>{t(label)}</label><HotkeyInput value={draft.hotkeys[key]} status={keyStatus(draft.hotkeys[key])} onChange={(value) => setKey(key, value)} label={t(label)} translate={t} /></div>)}
      </div>
    </SetupGroup>
    {blocked && <div className="setup-callout"><Keyboard size={18} aria-hidden="true" /><div><strong>{t("set.printScreen.title")}</strong><p>{t("set.printScreen.body")}</p><button type="button" className="setup-text-button" onClick={onWindowsSettings}>{t("set.printScreen.button")}<ArrowUpRight size={13} /></button></div></div>}
    {duplicates.length > 0 && <p className="setup-inline-error" role="alert">{t("setup.duplicateKeys")}</p>}
    <details className="setup-extra-keys" open={duplicates.length ? true : undefined}><summary>{t("setup.extraHotkeys")}<span>5</span></summary><div className="setup-card">{([
      ["text", "set.hotkeyText"], ["qr", "set.hotkeyQr"], ["fullScreen", "set.hotkeyScreen"], ["repeat", "set.hotkeyRepeat"], ["library", "set.hotkeyLibrary"],
    ] as [keyof Hotkeys, Key][]).map(([key, label]) => <div className="setup-key-row" key={key}><label>{t(label)}</label><HotkeyInput value={draft.hotkeys[key]} status={keyStatus(draft.hotkeys[key])} onChange={(value) => setKey(key, value)} label={t(label)} translate={t} /></div>)}</div></details>
    <SetupGroup title={t("setup.precision")}><div className="setup-card"><ToggleRow label={t("set.snap")} hint={t("setup.snapHint")} checked={draft.snap} onChange={(snap) => patch({ snap })} /><ToggleRow label={t("set.highlight")} hint={t("setup.highlightHint")} checked={draft.highlight} onChange={(highlight) => patch({ highlight })} />{draft.highlight && <ToggleRow label={t("set.elements")} hint={t("setup.elementsHint")} checked={draft.elements} onChange={(elements) => patch({ elements })} />}</div></SetupGroup>
  </>;
}

export function SavingStep({ draft, patch, t, info, pickingFolder, onPickFolder, now }: Controls & { info: AppInfo | null; pickingFolder: boolean; onPickFolder: () => void; now: Date }) {
  const folder = draft.saveDir || info?.defaultSaveDir || t("setup.defaultFolder");
  const synced = folder.split(/[\\/]/).some((part) => part.toLowerCase().startsWith("onedrive"));
  return <>
    <SetupGroup title={t("setup.destination")} hint={t("setup.folderHint")}>
      <div className="setup-folder-card"><div className="setup-folder-label"><span className="setup-row-icon"><FolderOpen size={22} /></span><div><small>{draft.saveDir ? t("setup.customFolder") : t("setup.defaultFolder")}</small><p title={folder}>{folder}</p></div></div><div className="setup-folder-actions"><button type="button" className="btn" onClick={onPickFolder} disabled={pickingFolder}>{pickingFolder ? t("setup.choosingFolder") : t("set.change")}<ArrowUpRight size={13} /></button>{draft.saveDir && <button type="button" className="setup-text-button" onClick={() => patch({ saveDir: "" })}>{t("set.useDefault")}</button>}</div></div>
      {synced && <p className="setup-folder-notice">{t("set.folderSynced")}</p>}
    </SetupGroup>
    <SetupGroup title={t("set.format")}>
      <div className="setup-format-grid">{(["png", "jpeg", "webp"] as const).map((format) => <button type="button" key={format} className={`setup-choice setup-format${draft.format === format ? " selected" : ""}`} aria-pressed={draft.format === format} onClick={() => patch({ format })}><FileImage size={19} /><strong>{format === "jpeg" ? "JPEG" : format.toUpperCase()}</strong><small>{t(`setup.format.${format}`)}</small><span className="setup-choice-check" aria-hidden="true">{draft.format === format && <Check size={12} />}</span></button>)}</div>
      {draft.format !== "png" && <div className="setup-quality"><label htmlFor="setup-quality">{t("set.quality")}</label><input id="setup-quality" type="range" min={10} max={100} value={draft.format === "jpeg" ? draft.jpegQuality : draft.webpQuality} onChange={(event) => patch(draft.format === "jpeg" ? { jpegQuality: Number(event.target.value) } : { webpQuality: Number(event.target.value) })} /><output htmlFor="setup-quality">{draft.format === "jpeg" ? draft.jpegQuality : draft.webpQuality}%</output></div>}
    </SetupGroup>
    <SetupGroup title={t("set.pattern")} hint={t("set.patternHint")}>
      <input id="setup-pattern" className="input setup-pattern-input" aria-label={t("set.pattern")} aria-invalid={!draft.filePattern.trim()} aria-describedby="setup-filename-preview" value={draft.filePattern} maxLength={240} spellCheck={false} onChange={(event) => patch({ filePattern: event.target.value })} />
      <div className="setup-pattern-tokens">{["{app}", "{title}", "{date}", "{time}"].map((token) => <button type="button" key={token} onClick={() => patch({ filePattern: `${draft.filePattern}${draft.filePattern && !draft.filePattern.endsWith(" ") ? " " : ""}${token}` })} aria-label={t("setup.insertToken", { token })}>{token}</button>)}</div>
      <div id="setup-filename-preview" className="setup-filename"><FileImage size={14} aria-hidden="true" /><span>{setupFilename(draft, now)}</span></div>
      {!draft.filePattern.trim() && <p className="setup-inline-error" role="alert">{t("setup.patternRequired")}</p>}
    </SetupGroup>
    <SetupGroup title={t("set.after")}><div className="setup-card"><ToggleRow icon={<FolderOpen size={17} />} label={t("set.saveAll")} hint={t("set.saveAllHint")} checked={draft.saveAll} onChange={(saveAll) => patch({ saveAll })} /><ToggleRow icon={<Clipboard size={17} />} label={t("set.copyAfter")} checked={draft.copyAfterCapture} onChange={(copyAfterCapture) => patch({ copyAfterCapture })} /><ToggleRow icon={<FileImage size={17} />} label={t("set.showCard")} checked={draft.showCard} onChange={(showCard) => patch({ showCard })} />{draft.showCard && <div className="setup-select-row"><label htmlFor="setup-card-seconds">{t("set.cardSeconds")}</label><select id="setup-card-seconds" className="select" value={draft.cardSeconds} onChange={(event) => patch({ cardSeconds: Number(event.target.value) })}>{[...new Set([3, 6, 10, 20, draft.cardSeconds])].sort((a, b) => a - b).map((seconds) => <option value={seconds} key={seconds}>{t("set.seconds", { n: seconds })}</option>)}</select></div>}<ToggleRow icon={<WandSparkles size={17} />} label={t("set.openEditor")} checked={draft.openEditor} onChange={(openEditor) => patch({ openEditor })} /></div></SetupGroup>
  </>;
}

export function SmartStep({ draft, patch, t, onSaving }: Controls & { onSaving: () => void }) {
  return <>
    <div className="setup-feature-card"><span className="setup-feature-icon"><Search size={24} /></span><div><h2>{t("setup.searchTitle")}</h2><p>{t("setup.searchBody")}</p></div><Switch label={t("set.indexText")} checked={draft.indexText} onChange={(indexText) => patch({ indexText })} /></div>
    {draft.indexText && !draft.saveAll && <div className="setup-callout"><FolderOpen size={17} /><div><p>{t("setup.searchNeedsSaving")}</p><button type="button" className="setup-text-button" onClick={onSaving}>{t("setup.goSaving")}<ArrowUpRight size={13} /></button></div></div>}
    <div className="setup-feature-card"><span className="setup-feature-icon"><ShieldCheck size={24} /></span><div><h2>{t("setup.privacyTitle")}</h2><p>{t("setup.privacyBody")}</p></div><Switch label={t("set.privacy")} checked={draft.privacyCheck} onChange={(privacyCheck) => patch({ privacyCheck })} /></div>
    <SetupGroup title={t("setup.keepTidy")}><div className="setup-card"><div className="setup-select-row"><div><label htmlFor="setup-cleanup">{t("set.autoClean")}</label><small>{t("set.autoCleanHint")}</small></div><select id="setup-cleanup" className="select" value={draft.autoCleanDays} onChange={(event) => patch({ autoCleanDays: Number(event.target.value) })}>{[...new Set([0, 30, 60, 90, 180, draft.autoCleanDays])].sort((a, b) => a - b).map((days) => <option key={days} value={days}>{t(days ? "set.autoCleanDays" : "set.autoCleanOff", { n: days })}</option>)}</select></div></div></SetupGroup>
    <div className="setup-local-note"><ShieldCheck size={18} /><p>{t("setup.localProcessing")}</p></div>
  </>;
}

function SummaryCard({ title, icon, onEdit, editLabel, children }: { title: string; icon: ReactNode; onEdit: () => void; editLabel: string; children: ReactNode }) {
  return <section className="setup-summary-card"><header><span>{icon}{title}</span><button type="button" onClick={onEdit} aria-label={`${editLabel}: ${title}`}>{editLabel}<ArrowUpRight size={12} /></button></header><dl>{children}</dl></section>;
}

export function ReviewStep({ draft, t, info, now, onEdit }: Omit<Controls, "patch"> & { info: AppInfo | null; now: Date; onEdit: (step: SetupStep) => void }) {
  const value = (enabled: boolean) => t(enabled ? "setup.on" : "setup.off");
  const row = (label: string, content: ReactNode) => <div key={label}><dt>{label}</dt><dd>{content}</dd></div>;
  const languages = { system: t("set.system"), en: "English", uz: "Oʻzbekcha", ru: "Русский" };
  return <>
    <div className="setup-review-note"><Sparkles size={19} /><p>{t("setup.reviewNote")}</p></div>
    <div className="setup-summary-grid">
      <SummaryCard title={t("setup.personalize.nav")} icon={<Monitor size={16} />} onEdit={() => onEdit("personalize")} editLabel={t("common.edit")}>{row(t("set.language"), languages[draft.language])}{row(t("set.theme"), t(`set.${draft.theme}`))}{row(t("set.startup"), value(draft.launchAtLogin))}</SummaryCard>
      <SummaryCard title={t("setup.capture.nav")} icon={<Keyboard size={16} />} onEdit={() => onEdit("capture")} editLabel={t("common.edit")}>{row(t("set.hotkey"), draft.hotkeys.capture ? <Keys value={draft.hotkeys.capture} /> : t("set.hotkeyNone"))}{row(t("set.hotkeyAlt"), draft.hotkeys.captureAlt ? <Keys value={draft.hotkeys.captureAlt} /> : t("set.hotkeyNone"))}{row(t("setup.extraHotkeys"), Object.entries(draft.hotkeys).filter(([key, shortcut]) => key !== "capture" && key !== "captureAlt" && shortcut).length)}{row(t("set.snap"), value(draft.snap))}{row(t("set.highlight"), value(draft.highlight))}{draft.highlight && row(t("set.elements"), value(draft.elements))}</SummaryCard>
      <SummaryCard title={t("setup.saving.nav")} icon={<FolderOpen size={16} />} onEdit={() => onEdit("saving")} editLabel={t("common.edit")}>{row(t("set.folder"), draft.saveDir || info?.defaultSaveDir || t("setup.defaultFolder"))}{row(t("set.format"), `${draft.format.toUpperCase()}${draft.format === "png" ? "" : ` · ${draft.format === "jpeg" ? draft.jpegQuality : draft.webpQuality}%`}`)}{row(t("set.pattern"), setupFilename(draft, now))}{row(t("set.saveAll"), value(draft.saveAll))}{row(t("set.copyAfter"), value(draft.copyAfterCapture))}{row(t("set.showCard"), draft.showCard ? t("set.seconds", { n: draft.cardSeconds }) : value(false))}{row(t("set.openEditor"), value(draft.openEditor))}</SummaryCard>
      <SummaryCard title={t("setup.smart.nav")} icon={<ShieldCheck size={16} />} onEdit={() => onEdit("smart")} editLabel={t("common.edit")}>{row(t("set.indexText"), value(draft.indexText))}{row(t("set.privacy"), value(draft.privacyCheck))}{row(t("set.autoClean"), t(draft.autoCleanDays ? "set.autoCleanDays" : "set.autoCleanOff", { n: draft.autoCleanDays }))}</SummaryCard>
    </div>
  </>;
}
