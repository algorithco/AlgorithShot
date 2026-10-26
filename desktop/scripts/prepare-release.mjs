import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createPlatformUpdateManifest, validateReleaseMetadata } from "./release.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(root, "..");

try {
  const input = process.argv[2];
  if (!input || process.argv.length !== 3) throw new Error("Usage: pnpm release:prepare <downloaded-artifact-directory>");
  const directory = realpathSync(resolve(repositoryRoot, input));
  const config = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const cargo = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
  const release = validateReleaseMetadata({ config, packageVersion: version, cargoVersion: /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1] });
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" });
  if (git.status !== 0) throw new Error("Could not determine the source revision.");
  const source = git.stdout.trim();
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], { cwd: repositoryRoot, encoding: "utf8" });
  const tag = spawnSync("git", ["rev-parse", `${release.tag}^{commit}`], { cwd: repositoryRoot, encoding: "utf8" });
  if (status.status !== 0 || status.stdout.trim() || tag.status !== 0 || tag.stdout.trim() !== source) throw new Error("Check out the clean, tagged source commit before preparing a release.");
  const artifacts = new Map();
  function inspect(path, depth = 0) {
    if (depth > 4) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Release artifacts must not contain symbolic links outside their app archives.");
      const file = join(path, entry.name);
      if (entry.isDirectory()) inspect(file, depth + 1);
      else if (entry.name === "build-info.json") {
        const info = JSON.parse(readFileSync(file, "utf8"));
        if (info.version !== release.version || info.tag !== release.tag || info.repository !== release.repository || info.source !== source || info.updaterPublicKey !== config.plugins.updater.pubkey) {
          throw new Error(`Release provenance does not match the current source commit: ${file}`);
        }
        if (artifacts.has(info.platform)) throw new Error(`Duplicate artifact group: ${info.platform}`);
        artifacts.set(info.platform, { path, info });
      }
    }
  }
  inspect(directory);
  for (const platform of ["windows-x86_64", "linux-x86_64", "darwin-universal"]) {
    if (!artifacts.has(platform)) throw new Error(`Missing artifact group: ${platform}`);
  }
  if (artifacts.size !== 3) throw new Error("Unexpected platform artifact group.");
  const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || process.env.TAURI_SIGNING_PRIVATE_KEY || join(root, ".local/updater/algorithshot.key");
  if (!existsSync(privateKey)) throw new Error("Set TAURI_SIGNING_PRIVATE_KEY_PATH to the maintainer's private key file.");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PATH", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"].includes(key.toUpperCase())));
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "";
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: repositoryRoot, stdio: "inherit", env });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal}).`);
  };
  const outputRoot = join(root, ".local/release", release.version);
  mkdirSync(outputRoot, { recursive: true });
  const output = mkdtempSync(join(outputRoot, "publish-"));
  const platforms = {};
  const cli = join(root, "node_modules/@tauri-apps/cli/tauri.js");
  for (const [platform, group] of artifacts) {
    const files = readdirSync(group.path).filter((name) => name.includes(release.version) && /\.(exe|AppImage|deb|rpm|dmg|app\.tar\.gz)$/.test(name));
    const updaterExtension = platform.startsWith("windows") ? ".exe" : platform.startsWith("linux") ? ".AppImage" : ".app.tar.gz";
    const updateFiles = files.filter((name) => name.endsWith(updaterExtension));
    if (updateFiles.length !== 1) throw new Error(`Expected one updater artifact for ${platform}`);
    for (const extension of platform.startsWith("linux") ? [".deb", ".rpm"] : platform.startsWith("darwin") ? [".dmg"] : []) {
      if (files.filter((name) => name.endsWith(extension)).length !== 1) throw new Error(`Missing or duplicate ${extension} installer for ${platform}`);
    }
    const file = join(group.path, updateFiles[0]);
    run(process.execPath, [cli, "signer", "sign", "--private-key-path", resolve(privateKey), "--app-version", version, file]);
    run("cargo", ["run", "--manifest-path", join(repositoryRoot, "tools/verify-update/Cargo.toml"), "--locked", "--", join(root, "src-tauri/tauri.conf.json"), file, `${file}.sig`, version]);
    const signed = { name: basename(file), signature: readFileSync(`${file}.sig`, "utf8").trim() };
    if (platform === "darwin-universal") { platforms["darwin-x86_64"] = signed; platforms["darwin-aarch64"] = signed; }
    else platforms[platform] = signed;
    for (const name of files) cpSync(join(group.path, name), join(output, name));
    cpSync(`${file}.sig`, join(output, `${basename(file)}.sig`));
    writeFileSync(join(output, `build-info-${platform}.json`), `${JSON.stringify(group.info, null, 2)}\n`);
    const notices = `THIRD_PARTY_LICENSES-${platform}.txt`;
    if (!existsSync(join(group.path, notices))) throw new Error(`Missing third-party license texts for ${platform}`);
    cpSync(join(group.path, notices), join(output, notices));
  }
  cpSync(join(repositoryRoot, "LICENSE"), join(output, "LICENSE"));
  cpSync(join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), join(output, "THIRD_PARTY_NOTICES.md"));
  writeFileSync(join(output, "latest.json"), `${JSON.stringify(createPlatformUpdateManifest(release, platforms), null, 2)}\n`);
  const checksums = readdirSync(output).sort().map((name) => `${createHash("sha256").update(readFileSync(join(output, name))).digest("hex")}  ${name}`);
  writeFileSync(join(output, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`);
  console.log(`Verified all platform signatures and source ${source}. Review the release files in ${output} before publishing.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
