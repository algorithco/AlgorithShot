import assert from "node:assert/strict";
import { test } from "node:test";
import { createUpdateManifest, updaterBuildConfig, validateRelease } from "./release.mjs";

function options() {
  return {
    config: {
      version: "0.2.0",
      plugins: { updater: { endpoints: ["https://github.com/algorithco/algorith-shot/releases/latest/download/latest.json"] } },
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
  assert.deepEqual(validateRelease(options()), { version: "0.2.0", tag: "v0.2.0", repository: "algorithco/algorith-shot" });
});

test("the manifest contains a signature and an exact versioned download URL", () => {
  const manifest = createUpdateManifest(validateRelease(options()), "AlgorithShot_0.2.0_x64-setup.exe", " signature-content\n");
  assert.equal(manifest.version, "0.2.0");
  assert.deepEqual(manifest.platforms["windows-x86_64"], {
    signature: "signature-content",
    url: "https://github.com/algorithco/algorith-shot/releases/download/v0.2.0/AlgorithShot_0.2.0_x64-setup.exe",
  });
  assert.ok(Number.isFinite(Date.parse(manifest.pub_date)));
});

test("the manifest refuses missing signatures, other versions and other architectures", () => {
  const release = validateRelease(options());
  assert.throws(() => createUpdateManifest(release, "AlgorithShot_0.2.0_x64-setup.exe", "\n"), /signature is empty/);
  assert.throws(() => createUpdateManifest(release, "AlgorithShot_0.1.0_x64-setup.exe", "sig"), /x64 NSIS installer/);
  assert.throws(() => createUpdateManifest(release, "AlgorithShot_0.2.0_arm64-setup.exe", "sig"), /x64 NSIS installer/);
});
