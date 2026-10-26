/** Release metadata shared by the local build script and its checks. */
export function validateReleaseMetadata({ config, packageVersion, cargoVersion }) {
  const version = config.version;
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error("Use a stable major.minor.patch release version.");
  if (version !== packageVersion || version !== cargoVersion) {
    throw new Error("Versions must match in package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json.");
  }
  const endpoint = config.plugins?.updater?.endpoints?.[0];
  const repository = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/latest\/download\/latest\.json$/.exec(endpoint)?.[1];
  if (!repository) throw new Error("Configure the public GitHub latest.json endpoint in tauri.conf.json.");
  return { version, tag: `v${version}`, repository };
}

export function validateRelease(options) {
  const release = validateReleaseMetadata(options);
  const { config, env } = options;
  if (!env.TAURI_UPDATER_PUBLIC_KEY?.trim()) throw new Error("Set TAURI_UPDATER_PUBLIC_KEY to the public signing key. See docs/UPDATES.md.");
  if (!env.TAURI_SIGNING_PRIVATE_KEY?.trim()) throw new Error("Set TAURI_SIGNING_PRIVATE_KEY before building a release. See docs/UPDATES.md.");
  const trustedKey = config.plugins?.updater?.pubkey?.trim();
  if (trustedKey && trustedKey !== env.TAURI_UPDATER_PUBLIC_KEY.trim()) {
    throw new Error("TAURI_UPDATER_PUBLIC_KEY must match the trusted public key in tauri.conf.json.");
  }
  return release;
}

/** Tauri's bundler must see the same public key embedded by the Rust plugin. */
export function updaterBuildConfig(publicKey) {
  return {
    bundle: { createUpdaterArtifacts: true },
    plugins: { updater: { pubkey: publicKey.trim() } },
  };
}

/** A contributor build never needs a private key or contacts the official feed. */
export function localBuildOptions(config, inheritedEnv) {
  const publicKey = config.plugins?.updater?.pubkey?.trim();
  if (!publicKey) throw new Error("Configure the updater public key in src-tauri/tauri.conf.json before building.");

  // Windows environment names are case-insensitive. Remove inherited overrides
  // as well as signing credentials before creating the child process environment.
  const replaced = new Set([
    "TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PATH", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "TAURI_CONFIG",
    "TAURI_UPDATER_PUBLIC_KEY", "VITE_DISABLE_UPDATES", "CARGO_TARGET_DIR",
  ]);
  const env = Object.fromEntries(Object.entries(inheritedEnv).filter(([key]) => !replaced.has(key.toUpperCase())));
  return {
    env: { ...env, TAURI_UPDATER_PUBLIC_KEY: publicKey, VITE_DISABLE_UPDATES: "1" },
    config: {
      bundle: { createUpdaterArtifacts: false },
      plugins: { updater: { pubkey: publicKey, endpoints: [] } },
    },
  };
}

export function createUpdateManifest({ version, tag, repository }, installerName, signature) {
  if (!signature.trim()) throw new Error("The installer signature is empty.");
  if (!installerName.endsWith(`_${version}_x64-setup.exe`)) {
    throw new Error("Expected the Windows x64 NSIS installer for this version.");
  }
  return {
    version,
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature: signature.trim(),
        url: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(installerName)}`,
      },
    },
  };
}

/** Every supported updater target must be present before publishing the feed. */
export function createPlatformUpdateManifest(release, artifacts) {
  const expected = ["windows-x86_64", "linux-x86_64", "darwin-x86_64", "darwin-aarch64"];
  const platforms = {};
  for (const target of expected) {
    const artifact = artifacts[target];
    if (!artifact?.signature?.trim()) throw new Error(`Missing signed updater artifact for ${target}`);
    const name = artifact.name;
    if (typeof name !== "string" || name.includes("/") || name.includes("\\") || !name.includes(`_${release.version}_`)) {
      throw new Error(`Invalid updater filename for ${target}`);
    }
    const extension = target.startsWith("windows") ? ".exe" : target.startsWith("linux") ? ".AppImage" : ".app.tar.gz";
    if (!name.endsWith(extension)) throw new Error(`Invalid updater file type for ${target}`);
    platforms[target] = { signature: artifact.signature.trim(), url: `https://github.com/${release.repository}/releases/download/${encodeURIComponent(release.tag)}/${encodeURIComponent(name)}` };
  }
  return { version: release.version, pub_date: new Date().toISOString(), platforms };
}
