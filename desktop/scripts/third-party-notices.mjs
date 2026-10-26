import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

function licenseFiles(directory, depth = 0) {
  if (depth > 4 || !existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !["node_modules", ".git", "target", "test", "tests"].includes(entry.name)) files.push(...licenseFiles(path, depth + 1));
    else if (entry.isFile() && /^(licen[cs]e|copying|notice)([._-].*)?$/i.test(entry.name)) files.push(path);
  }
  return files;
}

/** Include upstream text verbatim; never substitute the project's MIT license. */
export function collectThirdPartyNotices(root, env) {
  const sections = ["AlgorithShot third-party licenses\n\nThese notices cover installed build and runtime dependencies. Each component retains its own license.\nExact versions are recorded in the source lockfiles.\n"];
  const seen = new Set();
  function include(name, version, license, source, directory, extra = []) {
    const id = `${name}@${version}`;
    if (seen.has(id)) return;
    seen.add(id);
    const files = [...new Set([...licenseFiles(directory), ...extra.filter((f) => f && existsSync(f))])];
    sections.push(`\n${"=".repeat(78)}\n${id}\nLicense: ${typeof license === "string" ? license : JSON.stringify(license)}\nSource: ${source || "See the corresponding lockfile and package source."}\n`);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (text.includes("\0")) throw new Error(`A third-party license file is not text: ${basename(file)}`);
      sections.push(`\n--- ${relative(directory, file).replaceAll("\\", "/")} ---\n${text}\n`);
    }
    if (!files.length) sections.push("\nNo separate LICENSE/NOTICE file was included in this installed package. Consult the source identified above and the package manifest.\n");
  }
  const store = join(root, "../node_modules/.pnpm");
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const modules = join(store, entry.name, "node_modules");
    if (!existsSync(modules)) continue;
    for (const name of readdirSync(modules)) {
      const paths = name.startsWith("@") ? readdirSync(join(modules, name)).map((child) => join(modules, name, child)) : [join(modules, name)];
      for (const path of paths) {
        const manifest = join(path, "package.json");
        if (!existsSync(manifest)) continue;
        const pkg = JSON.parse(readFileSync(manifest, "utf8"));
        if (!pkg.name || !pkg.version) continue;
        include(pkg.name, pkg.version, pkg.license ?? pkg.licenses ?? "See package source", typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url ?? pkg.homepage, path);
      }
    }
  }
  const metadata = spawnSync("cargo", ["metadata", "--manifest-path", join(root, "src-tauri/Cargo.toml"), "--locked", "--format-version", "1"], { cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (metadata.status !== 0) throw new Error(`Could not read Rust dependency licenses: ${metadata.stderr}`);
  for (const pkg of JSON.parse(metadata.stdout).packages) {
    if (!pkg.source) continue;
    include(pkg.name, pkg.version, pkg.license ?? "See package source", pkg.repository ?? `https://crates.io/crates/${pkg.name}/${pkg.version}`, dirname(pkg.manifest_path), [pkg.license_file]);
  }
  include("Tauri NSIS template", "c464ef928c35d7eedd64bcd5df16b62b3393b7fa", "MIT", "https://github.com/tauri-apps/tauri", join(root, "src-tauri/windows"), [join(root, "src-tauri/windows/TAURI-LICENSE-MIT")]);
  include("Tesseract fast language models", "87416418657359cb625c412a48b6e1d6d41c29bd", "Apache-2.0", "https://github.com/tesseract-ocr/tessdata_fast", join(root, "ocr-data"));
  include("SeetaFace model", "fa3d5b5d576c91d1c8a099af381e0f0906a0d3a3", "BSD-2-Clause", "https://github.com/atomashpolskiy/rustface", join(root, "src-tauri/models"));
  if (process.platform === "linux") {
    for (const name of ["libatspi2.0-0", "libgtk-3-0t64", "libgtk-3-0", "libwebkit2gtk-4.1-0", "libpipewire-0.3-0t64", "libpipewire-0.3-0", "libxcb1", "libxrandr2", "libayatana-appindicator3-1"]) {
      const copyright = `/usr/share/doc/${name}/copyright`;
      if (existsSync(copyright)) sections.push(`\n${"=".repeat(78)}\nLinux system component: ${name}\n${readFileSync(copyright, "utf8")}\n`);
    }
    for (const license of ["LGPL-2.1", "LGPL-3", "GPL-2", "GPL-3"]) {
      const path = `/usr/share/common-licenses/${license}`;
      if (existsSync(path)) sections.push(`\n${"=".repeat(78)}\n${license}\n${readFileSync(path, "utf8")}\n`);
    }
  }
  const output = join(root, ".local/third-party-licenses.txt");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, sections.join(""));
  return output;
}
