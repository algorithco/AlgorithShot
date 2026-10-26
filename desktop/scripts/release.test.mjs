import assert from "node:assert/strict";
import { test } from "node:test";
import { createPlatformUpdateManifest, createUpdateManifest, localBuildOptions, updaterBuildConfig, validateRelease, validateReleaseMetadata } from "./release.mjs";

function options() {
  return {
    config: {
      version: "0.2.0",
      plugins: { updater: { endpoints: ["https://github.com/algorithco/algorith-shot-releases/releases/latest/download/latest.json"] } },
    },
    packageVersion: "0.2.0",
    cargoVersion: "0.2.0",
    env: { TAURI_UPDATER_PUBLIC_KEY: "test-public-key", TAURI_SIGNING_PRIVATE_KEY: "test-key-path" },
  };
}

test("release version must match across all three manifests", () => {
  assert.throws(() => validateRelease({ ...options(), cargoVersion: "0.1.0" }), /Versions must match/);
  assert.throws(() => validateRelease({ ...options(), packageVersion: "0.1.0" }), /Versions must match/);
});

test("an unsigned or unconfigured release is rejected before the build", () => {
  assert.throws(() => validateRelease({ ...options(), env: {} }), /TAURI_UPDATER_PUBLIC_KEY/);
  assert.throws(() => validateRelease({ ...options(), env: { TAURI_UPDATER_PUBLIC_KEY: "key" } }), /TAURI_SIGNING_PRIVATE_KEY/);
});

test("release builds accept stable semantic versions only", () => {
  const input = options();
  input.config.version = "0.2.0-beta.1";
  assert.throws(() => validateRelease(input), /stable/);
  input.config.version = "00.2.0";
  assert.throws(() => validateRelease(input), /stable/);
});

test("the build override supplies the public key to the bundler and enables signatures", () => {
  assert.deepEqual(updaterBuildConfig(" test-public-key\r\n"), {
    bundle: { createUpdaterArtifacts: true },
    plugins: { updater: { pubkey: "test-public-key" } },
  });
});

test("a different environment key cannot silently replace the app's trusted signing identity", () => {
  const input = options();
  input.config.plugins.updater.pubkey = "original-public-key";
  assert.throws(() => validateRelease(input), /must match the trusted public key/);
  input.env.TAURI_UPDATER_PUBLIC_KEY = "original-public-key";
  assert.equal(validateRelease(input).version, "0.2.0");
});

test("the public feed determines which repository owns installer URLs", () => {
  const input = options();
  input.config.plugins.updater.endpoints[0] = "https://example.com/latest.json";
  assert.throws(() => validateRelease(input), /public GitHub/);
  assert.deepEqual(validateRelease(options()), { version: "0.2.0", tag: "v0.2.0", repository: "algorithco/algorith-shot-releases" });
});

test("the manifest contains a signature and an exact versioned download URL", () => {
  const manifest = createUpdateManifest(validateRelease(options()), "AlgorithShot_0.2.0_x64-setup.exe", " signature-content\n");
  assert.equal(manifest.version, "0.2.0");
  assert.deepEqual(manifest.platforms["windows-x86_64"], {
    signature: "signature-content",
    url: "https://github.com/algorithco/algorith-shot-releases/releases/download/v0.2.0/AlgorithShot_0.2.0_x64-setup.exe",
  });
  assert.ok(Number.isFinite(Date.parse(manifest.pub_date)));
});

test("the manifest refuses missing signatures, other versions and other architectures", () => {
  const release = validateRelease(options());
  assert.throws(() => createUpdateManifest(release, "AlgorithShot_0.2.0_x64-setup.exe", "\n"), /signature is empty/);
  assert.throws(() => createUpdateManifest(release, "AlgorithShot_0.1.0_x64-setup.exe", "sig"), /x64 NSIS installer/);
  assert.throws(() => createUpdateManifest(release, "AlgorithShot_0.2.0_arm64-setup.exe", "sig"), /x64 NSIS installer/);
});

test("local builds work without private credentials and disable update distribution", () => {
  const config = { plugins: { updater: { pubkey: " public-key\n", endpoints: ["https://example.com/latest.json"] } } };
  const original = structuredClone(config);
  const result = localBuildOptions(config, { PATH: "test-path" });
  assert.equal(result.env.TAURI_UPDATER_PUBLIC_KEY, "public-key");
  assert.equal(result.env.VITE_DISABLE_UPDATES, "1");
  assert.equal(result.env.PATH, "test-path");
  assert.equal(result.env.TAURI_SIGNING_PRIVATE_KEY, undefined);
  assert.equal(result.config.bundle.createUpdaterArtifacts, false);
  assert.deepEqual(result.config.plugins.updater.endpoints, []);
  assert.deepEqual(config, original);
});

test("inherited release credentials and config cannot leak into a Windows local build", () => {
  const inherited = {
    TAURI_SIGNING_PRIVATE_KEY: "test-private-key-path",
    TAURI_SIGNING_PRIVATE_KEY_PATH: "test-private-file-path",
    tauri_signing_private_key_password: "test-password",
    tauri_updater_public_key: "different-public-key",
    Tauri_Config: "test-release-config",
    vite_disable_updates: "0",
    Cargo_Target_Dir: "test-release-directory",
  };
  const result = localBuildOptions({ plugins: { updater: { pubkey: "configured-public-key" } } }, inherited);
  assert.deepEqual(result.env, { TAURI_UPDATER_PUBLIC_KEY: "configured-public-key", VITE_DISABLE_UPDATES: "1" });
  assert.equal(inherited.TAURI_SIGNING_PRIVATE_KEY, "test-private-key-path");
});

test("local builds reject a missing public key even if an environment override exists", () => {
  assert.throws(() => localBuildOptions({}, { TAURI_UPDATER_PUBLIC_KEY: "environment-key" }), /public key/);
  assert.throws(() => localBuildOptions({ plugins: { updater: { pubkey: "  " } } }, {}), /public key/);
});

function allPlatforms() {
  return {
    "windows-x86_64": { name: "AlgorithShot_0.2.0_x64-setup.exe", signature: "windows-signature" },
    "linux-x86_64": { name: "AlgorithShot_0.2.0_amd64.AppImage", signature: "linux-signature" },
    "darwin-x86_64": { name: "AlgorithShot_0.2.0_universal.app.tar.gz", signature: "mac-signature" },
    "darwin-aarch64": { name: "AlgorithShot_0.2.0_universal.app.tar.gz", signature: "mac-signature" },
  };
}

test("build metadata validation needs no private signing material", () => {
  assert.equal(validateReleaseMetadata({ ...options(), env: undefined }).tag, "v0.2.0");
});

test("a complete update feed supports Windows, Linux and both Mac architectures", () => {
  const manifest = createPlatformUpdateManifest(validateReleaseMetadata(options()), allPlatforms());
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"]);
  assert.match(manifest.platforms["linux-x86_64"].url, /algorith-shot-releases\/releases\/download\/v0\.2\.0\//);
  assert.equal(manifest.platforms["darwin-aarch64"].url, manifest.platforms["darwin-x86_64"].url);
});

test("a release feed cannot omit a supported platform or use an unsigned, wrong-version or wrong-type artifact", () => {
  const release = validateReleaseMetadata(options());
  const missing = allPlatforms();
  delete missing["linux-x86_64"];
  assert.throws(() => createPlatformUpdateManifest(release, missing), /linux-x86_64/);
  for (const name of ["../AlgorithShot_0.2.0_x64-setup.exe", "AlgorithShot_0.1.2_x64-setup.exe", "AlgorithShot_0.2.0_universal.dmg"]) {
    const artifacts = allPlatforms();
    artifacts["windows-x86_64"].name = name;
    assert.throws(() => createPlatformUpdateManifest(release, artifacts), /windows-x86_64/);
  }
  const unsigned = allPlatforms();
  unsigned["darwin-aarch64"].signature = " ";
  assert.throws(() => createPlatformUpdateManifest(release, unsigned), /darwin-aarch64/);
});
