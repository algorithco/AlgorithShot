import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { localBuildOptions } from "./release.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.some((arg) => arg !== "--debug")) throw new Error("Usage: pnpm build:local [--debug]");
  const debug = args.includes("--debug");
  const config = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const options = localBuildOptions(config, process.env);
  const target = join(root, "src-tauri/target/local");
  const env = { ...options.env, CARGO_TARGET_DIR: target };
  const run = (command, commandArgs) => {
    const result = spawnSync(command, commandArgs, { cwd: root, stdio: "inherit", env });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal}).`);
  };

  const cli = join(root, "node_modules/@tauri-apps/cli/tauri.js");
  run(process.execPath, [cli, "build", "--no-bundle", ...(debug ? ["--debug"] : []), "--config", JSON.stringify(options.config)]);
  const executable = join(target, debug ? "debug" : "release", process.platform === "win32" ? "algorithco-shot.exe" : "algorithco-shot");
  // Verify embedded pages without opening the app or touching the user's library.
  run(executable, ["--verify-assets"]);
  console.log(`Local build ready: ${executable}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
