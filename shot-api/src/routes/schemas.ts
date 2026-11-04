import { errorSchema } from "../errors.ts";

export const string = { type: "string" };
export const nullableString = { type: ["string", "null"] };
export const integer = { type: "integer" };
export const boolean = { type: "boolean" };
export const limits = { type: "object", additionalProperties: true };

export function object(properties: Record<string, unknown>) {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}

export const entitlementSchema = object({
  product: { type: "string", enum: ["shot"] }, plan: { type: "string", enum: ["free"] },
  status: { type: "string", enum: ["active", "grace"] }, limits, validUntil: nullableString,
});

export const offlinePolicySchema = object({
  licenseRequired: boolean, policyVersion: integer, maxAgeSeconds: integer, refreshAfterSeconds: integer,
  audience: string, jwksUrl: string,
});

export const protectedErrors = Object.fromEntries([400, 401, 403, 413, 415, 429, 500, 503].map((status) => [status, errorSchema]));
export const bearerSecurity = [{ bearerAuth: [] }];
