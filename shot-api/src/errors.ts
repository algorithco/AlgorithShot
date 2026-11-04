import type { FastifyError, FastifyInstance } from "fastify";

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryAfterSeconds: number | undefined;

  constructor(statusCode: number, code: string, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const unauthorized = () => new ApiError(401, "unauthorized", "A valid AlgorithShot access token is required.");
export const unavailable = () => new ApiError(503, "account_service_unavailable", "The Account service is temporarily unavailable.");
export const contractError = () => new ApiError(503, "account_contract_mismatch", "The Account integration is not configured correctly.");

export const errorSchema = {
  type: "object", additionalProperties: false, required: ["error"],
  properties: { error: {
    type: "object", additionalProperties: false, required: ["code", "message", "requestId"],
    properties: { code: { type: "string" }, message: { type: "string" }, requestId: { type: "string" } },
  } },
} as const;

export function registerErrors(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    let failure: ApiError;
    if (error instanceof ApiError) failure = error;
    else if (error.statusCode === 429) failure = new ApiError(429, "rate_limited", "Too many requests. Try again later.");
    else if (error.validation || error.statusCode === 400) failure = new ApiError(400, "invalid_request", "The request does not match the API schema.");
    else if (error.statusCode === 413) failure = new ApiError(413, "request_too_large", "The request body is too large.");
    else if (error.statusCode === 415) failure = new ApiError(415, "unsupported_media_type", "Use an application/json request body.");
    else {
      // Upstream exception messages may contain credentials; log a category only.
      request.log.error({ requestId: request.id, category: "request_failed" }, "Request failed");
      failure = new ApiError(500, "internal_error", "The request could not be completed.");
    }
    if (failure.statusCode === 401) reply.header("WWW-Authenticate", 'Bearer realm="shot-api"');
    if (failure.retryAfterSeconds !== undefined) reply.header("Retry-After", failure.retryAfterSeconds);
    reply.header("Cache-Control", "no-store").code(failure.statusCode).send({
      error: { code: failure.code, message: failure.message, requestId: request.id },
    });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({
    error: { code: "not_found", message: "The endpoint does not exist.", requestId: request.id },
  }));
}
