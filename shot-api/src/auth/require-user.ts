import type { FastifyRequest } from "fastify";
import { ApiError, unauthorized } from "../errors.ts";
import type { AccountIdentity, AuthUser } from "./identity.ts";

declare module "fastify" {
  interface FastifyRequest { auth: AuthUser | null }
}

export function requireUser(identity: AccountIdentity, scope?: string | readonly string[]) {
  return async (request: FastifyRequest): Promise<void> => {
    const header = request.headers.authorization;
    if (!header || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(header)) throw unauthorized();
    const user = await identity.accessToken(header.slice(7));
    for (const required of typeof scope === "string" ? [scope] : scope ?? []) {
      if (!user.scopes.has(required)) throw new ApiError(403, "insufficient_scope", `The ${required} scope is required.`);
    }
    request.auth = user;
  };
}

export function currentUser(request: FastifyRequest): AuthUser {
  if (!request.auth) throw unauthorized();
  return request.auth;
}
