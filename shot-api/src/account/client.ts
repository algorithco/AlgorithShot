import type { ApiConfig } from "../config.ts";
import { SHOT_PRODUCT } from "../config.ts";
import { ApiError, contractError } from "../errors.ts";
import type { AccountIdentity, AuthUser } from "../auth/identity.ts";
import { AccountHttp, record } from "./http.ts";

export interface ShotEntitlement {
  product: "shot";
  plan: "free";
  status: "active" | "grace";
  limits: Record<string, unknown>;
  validUntil: string | null;
}

export const SHOT_FEATURES = ["capture", "ocr", "editor", "library", "qr", "pin"] as const;

export class AccountClient {
  readonly config: ApiConfig;
  readonly http: AccountHttp;
  readonly identity: AccountIdentity;

  constructor(config: ApiConfig, http: AccountHttp, identity: AccountIdentity) {
    this.config = config;
    this.http = http;
    this.identity = identity;
  }

  async entitlement(user: AuthUser): Promise<ShotEntitlement> {
    const { body } = await this.http.json(`${this.config.account.apiBaseUrl}/v1/entitlements?product=${SHOT_PRODUCT}`, {
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    if (!record(body) || !Array.isArray(body.entitlements)) throw contractError();
    if (!body.entitlements.length) throw new ApiError(403, "entitlement_required", "Shot access is not available for this account.");
    if (body.entitlements.length !== 1) throw contractError();
    const item: unknown = body.entitlements[0];
    if (!record(item) || item.product !== SHOT_PRODUCT || !record(item.limits) ||
        !record(item.owner) || item.owner.type !== "user" || item.owner.id !== user.sub ||
        (item.validUntil !== null && (typeof item.validUntil !== "string" || !Number.isFinite(Date.parse(item.validUntil))))) throw contractError();
    if (item.plan !== "free" || (item.status !== "active" && item.status !== "grace") ||
        (typeof item.validUntil === "string" && Date.parse(item.validUntil) <= Date.now())) {
      throw new ApiError(403, "entitlement_required", "An active Shot Free entitlement is required.");
    }
    return { product: SHOT_PRODUCT, plan: "free", status: item.status as "active" | "grace", limits: item.limits, validUntil: item.validUntil as string | null };
  }

  async offlineLicense(user: AuthUser, deviceId: string) {
    const entitlement = await this.entitlement(user);
    // No automatic retries: Account does not promise idempotent license issuance.
    const { body } = await this.http.json(`${this.config.account.apiBaseUrl}/v1/licenses`, {
      method: "POST", headers: { Authorization: `Bearer ${user.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ product: SHOT_PRODUCT, device_id: deviceId }),
    });
    if (!record(body) || typeof body.license !== "string" || typeof body.expires_at !== "string") throw contractError();
    const claims = await this.identity.license(body.license, user, deviceId);
    if (Math.floor(Date.parse(body.expires_at) / 1000) !== claims.exp) throw contractError();
    if (entitlement.validUntil !== null && (claims.exp as number) * 1000 > Date.parse(entitlement.validUntil)) throw contractError();
    return {
      license: body.license, expiresAt: new Date((claims.exp as number) * 1000).toISOString(),
      product: SHOT_PRODUCT, plan: "free" as const, deviceId,
      refreshAfterSeconds: Math.min(this.config.offline.refreshAfterSeconds, Math.max(0, Math.floor((claims.exp as number) - Date.now() / 1000))),
    };
  }
}
