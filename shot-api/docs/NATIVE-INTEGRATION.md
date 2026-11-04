# Desktop integration contract

This document specifies work for the desktop application. No desktop files were modified by the Shot API implementation.

## Authentication

Fetch `/api/v1/auth/config` from the configured HTTPS Shot API. Pin the expected Account issuer in the native application: a public config response cannot establish a new trust root. Discover OIDC endpoints, check the exact issuer, and require S256 PKCE and ES256 ID tokens.

The native Rust process owns the loopback listener, state, nonce, PKCE verifier, HTTP token exchange and refresh. Open the OS browser; do not embed a password form in a WebView. Listen only on `127.0.0.1`, use an ephemeral port and `/callback`, and close after success, cancellation or timeout. Validate state, code transaction, ID-token signature/issuer/audience/nonce/expiry. Send `prompt=consent`, the requested scopes and `resource=urn:algorithco:platform-api`; optionally send a safe `device_name`. Handle Approve/Deny and cancellation. Do not implement retired pairing-code parameters.

Store the rotated refresh token in Windows Credential Manager/DPAPI, macOS Keychain or the Linux credential vault. Serialize refresh operations and atomically replace the old token. A reused refresh token can revoke the entire grant. Keep tokens out of localStorage, settings files, logs and React state. Prefer native HTTP for authenticated API calls; expose account summaries to React via Tauri commands. If WebView fetch is used for public API data, its Tauri `connect-src` also needs the explicitly configured API origin.

## Account screen

`GET /api/v1/me` returns verified profile and current native grant metadata. Names are nullable. Profile information is a snapshot from a short-lived token; refresh after returning from account management.

`GET /api/v1/me/access` performs a live entitlement check and returns the Free plan, active status, capabilities, check time and offline policy. `/me` by itself is not evidence of current entitlement. Present the local, natively verified license's expiry alongside this response.

Open `account.manageUrl` in the browser for password/profile/MFA/identity/session/deletion management. A user-initiated web sign-out and app logout are different operations. To log the app out, try the discovered OIDC revocation endpoint with the native refresh token while online, then remove local auth/license state even if the network is unavailable. Never offer an API logout that merely returns success while keeping refresh credentials valid.

## Offline license and mandatory login

Create and securely retain a random UUID v4 per installation. POST `{ "deviceId": "<uuid-v4>" }` to `/api/v1/me/offline-license` using a valid access token. The API always requests the Shot product and checks current entitlement first. Treat `license` as opaque in the UI.

Native verification must require ES256, trusted license `kid`, issuer, `aud=algorithco-products`, correct `sub`, `product=shot`, `plan=free`, exact installation `device_id`, `jti`, `iat`, `exp` and allowed lifetime. Use the dedicated license JWKS URL, not the OIDC key set. Refetch unknown keys only while online, with bounded retries/cooldown. Cache public keys through the permitted license window with overlap rotation. Never accept a key supplied in JWT headers.

The default maximum offline lifetime is seven days; the API does not shorten or re-sign a token returned by Account. A longer token is rejected. Daily online renewal is recommended. Temporary connectivity failure may preserve a previously valid license until its signed expiry; it never extends that expiry. A clear auth revocation (`401`, `invalid_grant`) is not a network outage and clears local authorization. Track last trusted server time to detect clock rollback. A random device ID is a binding identifier, not a claim of hardware-backed attestation.

Implement one native access gate for capture hotkeys, tray actions, CLI flags, OCR/QR, editor and other protected Tauri commands. A React route guard alone cannot enforce login. States: signed out, signing in, signed in online, signed in offline, reauthentication required. Cancel or refuse new protected work when authorization ends while preserving files and in-progress data.

Migration preserves screenshots, `.originals`, library index and saved settings. A prior local library is not silently uploaded or made cloud account property. On account switch, never reuse the prior subject's token/license cache. Per-account local library isolation is a separate product decision. Update desktop/product documentation to explain required registration and periodic online authorization while images remain local.

## Errors

Errors use `{ "error": { "code", "message", "requestId" } }`; the response also has `X-Request-Id`.

| Status | Native behavior |
| --- | --- |
| 400 | Fix the request; do not retry invalid device/product fields |
| 401 | Refresh once or reauthenticate; a rejected refresh ends the local sign-in |
| 403 | Verification/scope/entitlement is insufficient; do not unlock features |
| 429 | Respect `Retry-After`; do not loop license requests |
| 503 | Account, trust data or policy is unavailable; preserve only a still-valid cached offline license |

There is no anonymous fallback. Existing signed JWTs and offline licenses have bounded revocation delay; do not promise immediate remote revocation while offline. Official app gates and server authorization have different enforcement boundaries, particularly for a modified open-source client.
