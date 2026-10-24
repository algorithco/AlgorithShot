import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createUpdateManifest, updaterBuildConfig, validateRelease } from "./release.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));

try {
  const config = readJson("src-tauri/tauri.conf.json");
  const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
  const localKey = join(root, ".local/updater/algorithshot.key");
  const releaseEnv = {
    ...process.env,
    TAURI_UPDATER_PUBLIC_KEY: process.env.TAURI_UPDATER_PUBLIC_KEY?.trim() || config.plugins?.updater?.pubkey?.trim(),
    TAURI_SIGNING_PRIVATE_KEY: process.env.TAURI_SIGNING_PRIVATE_KEY || (existsSync(localKey) ? localKey : undefined),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
  };
  const release = validateRelease({
    config,
    packageVersion: readJson("package.json").version,
    cargoVersion: /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1],
    env: releaseEnv,
  });
  // Run the installed JS CLI directly: pnpm's own executable can be JS or native.
  // No shell interpolation of arguments or signing keys.
  const override = JSON.stringify(updaterBuildConfig(releaseEnv.TAURI_UPDATER_PUBLIC_KEY));
  const cli = join(root, "node_modules/@tauri-apps/cli/tauri.js");
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: releaseEnv });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal}).`);
  };
  run(process.execPath, [cli, "build", "--no-bundle", "--config", override]);
  // Validate the executable's asset lookups and decompression, not just dist/.
  // This mode exits before opening windows or touching the user's app data.
  run(join(root, "src-tauri/target/release/algorithco-shot.exe"), ["--verify-assets"]);
  run(process.execPath, [cli, "bundle", "--config", override]);

  const output = join(root, "src-tauri/target/release/bundle/nsis");
  const installer = `${config.productName}_${release.version}_x64-setup.exe`;
  if (!existsSync(join(output, installer))) throw new Error(`The signed installer is missing: ${installer}`);
  const signature = readFileSync(join(output, `${installer}.sig`), "utf8");
  const manifest = createUpdateManifest(release, installer, signature);
  writeFileSync(join(output, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Signed release ${release.tag} and latest.json are ready in ${output}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
