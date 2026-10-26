import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { validateReleaseMetadata } from "./release.mjs";
import { collectThirdPartyNotices } from "./third-party-notices.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const sourceBefore = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  const dirtyBefore = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, encoding: "utf8" });
  if (sourceBefore.status !== 0 || dirtyBefore.status !== 0 || dirtyBefore.stdout.trim()) throw new Error("Commit the source changes before building official release artifacts. Use pnpm build:local for development.");
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  let target;
  if (args.length) {
    if (process.platform !== "darwin" || args.join(" ") !== "--target universal-apple-darwin") throw new Error("Usage: pnpm release:build:unsigned [--target universal-apple-darwin]");
    target = "universal-apple-darwin";
  }
  const config = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
  const release = validateReleaseMetadata({ config, packageVersion: version, cargoVersion: /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1] });
  const publicKey = config.plugins?.updater?.pubkey?.trim();
  if (!publicKey) throw new Error("Configure the trusted updater public key before building.");
  const targetDir = join(root, "src-tauri/target/release-build");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PATH", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "TAURI_CONFIG", "CARGO_TARGET_DIR", "TAURI_UPDATER_PUBLIC_KEY", "VITE_DISABLE_UPDATES"].includes(key.toUpperCase())));
  Object.assign(env, { CARGO_TARGET_DIR: targetDir, TAURI_UPDATER_PUBLIC_KEY: publicKey, VITE_DISABLE_UPDATES: "0" });
  const run = (command, commandArgs) => {
    const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", env });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal}).`);
  };
  const cli = join(root, "node_modules/@tauri-apps/cli/tauri.js");
  const notices = collectThirdPartyNotices(root, env);
  const override = JSON.stringify({ bundle: { createUpdaterArtifacts: false, resources: { "../.local/third-party-licenses.txt": "licenses/THIRD_PARTY_LICENSES.txt", "../../LICENSE": "licenses/AlgorithShot.txt" } } });
  const targetArgs = target ? ["--target", target] : [];
  run(process.execPath, [cli, "build", "--no-bundle", ...targetArgs, "--config", override]);
  const releaseDir = join(targetDir, ...(target ? [target] : []), "release");
  const executable = join(releaseDir, process.platform === "win32" ? "algorithco-shot.exe" : "algorithco-shot");
  run(executable, ["--verify-assets"]);
  if (process.platform !== "win32") run(executable, ["--verify-platform"]);
  run(process.execPath, [cli, "bundle", ...targetArgs, "--config", override]);

  const platform = process.platform === "win32" ? "windows-x86_64" : process.platform === "linux" ? "linux-x86_64" : target ? "darwin-universal" : `darwin-${process.arch === "arm64" ? "aarch64" : "x86_64"}`;
  const output = join(root, ".local/release", release.version, platform);
  mkdirSync(output, { recursive: true });
  const bundle = join(releaseDir, "bundle");
  function collect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory() && !entry.name.endsWith(".app")) collect(path);
      if (entry.isFile() && /\.(exe|dmg|AppImage|deb|rpm)$/.test(entry.name) && entry.name.includes(release.version)) cpSync(path, join(output, entry.name));
    }
  }
  collect(bundle);
  if (process.platform === "linux") {
    const images = readdirSync(output).filter((name) => name.endsWith(".AppImage"));
    if (images.length !== 1) throw new Error("Expected exactly one Linux AppImage.");
    const verification = spawnSync(join(output, images[0]), ["--verify-platform"], {
      cwd: root, stdio: "inherit", env: { ...env, APPIMAGE_EXTRACT_AND_RUN: "1" },
    });
    if (verification.error) throw verification.error;
    if (verification.status !== 0) throw new Error("The packaged AppImage failed native verification.");
  }
  if (process.platform === "darwin") {
    const app = `${config.productName}.app`;
    if (!existsSync(join(bundle, "macos", app))) throw new Error("The macOS application bundle is missing.");
    const bundledExecutable = join(bundle, "macos", app, "Contents/MacOS/algorithco-shot");
    run("codesign", ["--verify", "--deep", "--strict", join(bundle, "macos", app)]);
    if (target) run("lipo", ["-verify_arch", "x86_64", "arm64", bundledExecutable]);
    run(bundledExecutable, ["--verify-platform"]);
    const archive = join(output, `${config.productName}_${version}_${target ? "universal" : process.arch}.app.tar.gz`);
    run("tar", ["-czf", archive, "-C", join(bundle, "macos"), app]);
  }
  const source = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  const dirtyAfter = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: root, encoding: "utf8" });
  if (source.status !== 0 || dirtyAfter.status !== 0 || dirtyAfter.stdout.trim() || source.stdout.trim() !== sourceBefore.stdout.trim()) throw new Error("The source changed during the release build. Build again from a clean, committed source revision.");
  writeFileSync(join(output, "build-info.json"), `${JSON.stringify({ ...release, platform, source: source.stdout.trim(), updaterPublicKey: publicKey }, null, 2)}\n`);
  cpSync(join(root, "../LICENSE"), join(output, "LICENSE"));
  cpSync(join(root, "../THIRD_PARTY_NOTICES.md"), join(output, "THIRD_PARTY_NOTICES.md"));
  cpSync(notices, join(output, `THIRD_PARTY_LICENSES-${platform}.txt`));
  console.log(`Unsigned ${platform} artifacts are ready in ${output}. Sign and review all platforms before publishing latest.json.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
