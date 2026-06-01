import type { NextFunction, Request, Response } from "express";
import { jwtVerify } from "jose";
import { z } from "zod";
import type { DashboardConfig } from "./config.js";

const claimsSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email().optional()
});

export interface AuthContext {
  userId: string;
  email?: string;
}

export interface AuthenticatedRequest extends Request {
  auth: AuthContext;
}

function getBearerToken(request: Request): string | undefined {
  const authorization = request.header("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return undefined;
  }

  return authorization.slice("Bearer ".length).trim();
}

export function createAuthMiddleware(config: DashboardConfig) {
  const secret = new TextEncoder().encode(config.supabaseJwtSecret);

  return async (request: Request, response: Response, next: NextFunction) => {
    try {
      const token = getBearerToken(request);

      if (!token) {
        response.status(401).json({ error: "Missing bearer token" });
        return;
      }

      (request as AuthenticatedRequest).auth = await verifySupabaseJwt(token, config);
      next();
    } catch (_error) {
      response.status(401).json({ error: "Invalid bearer token" });
    }
  };
}

export async function verifySupabaseJwt(token: string, config: DashboardConfig): Promise<AuthContext> {
  const secret = new TextEncoder().encode(config.supabaseJwtSecret);
  const verifyOptions = config.supabaseUrl
    ? { issuer: `${config.supabaseUrl}/auth/v1`, audience: "authenticated" }
    : { audience: "authenticated" };
  const result = await jwtVerify(token, secret, verifyOptions);
  const claims = claimsSchema.parse(result.payload);
  const auth: AuthContext = { userId: claims.sub };

  if (claims.email) {
    auth.email = claims.email;
  }

  return auth;
}

export function requireAuth(request: Request): AuthContext {
  return (request as AuthenticatedRequest).auth;
}
