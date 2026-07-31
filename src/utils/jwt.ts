import jwt from "jsonwebtoken";
import { env } from "../config/env";

export type SessionPayload = {
  sub: string; // user id
  email: string;
  role: "ADMIN" | "CUSTOMER";
};

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

export function verifySession(token: string): SessionPayload {
  return jwt.verify(token, env.jwtSecret) as SessionPayload;
}
