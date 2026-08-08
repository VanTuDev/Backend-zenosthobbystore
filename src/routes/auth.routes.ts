import { randomBytes } from "node:crypto";
import { Router, type Response } from "express";
import { z } from "zod";
import { env, isGoogleOAuthConfigured } from "../config/env";
import { attachUser, requireAuth, SESSION_COOKIE_NAME } from "../middleware/auth";
import { requireDb } from "../middleware/require-db";
import { User, type UserDoc } from "../models/user.model";
import { ApiError } from "../utils/api-error";
import { asyncHandler } from "../utils/async-handler";
import { signSession } from "../utils/jwt";
import type { HydratedDocument } from "mongoose";

export const authRouter = Router();

const STATE_COOKIE_NAME = "zenos_oauth_state";
const isProd = env.nodeEnv === "production";

const cookieOptions = {
  httpOnly: true,
  // Frontend (zenosthobbystore.com) and backend (onrender.com) are different registrable
  // domains, so every axios call from the browser is cross-site — SameSite=Lax cookies get SET
  // fine during the OAuth redirect (a top-level navigation) but are never SENT back on the
  // follow-up XHR (e.g. GET /auth/me), which is why login "succeeds" yet the session 401s right
  // after. SameSite=None is required for cross-site XHR, and the spec mandates Secure with it —
  // both only kick in for isProd; local dev keeps Lax since localhost:3000/4000 are same-site.
  sameSite: isProd ? ("none" as const) : ("lax" as const),
  secure: isProd,
  path: "/",
};

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function toPublicUser(user: HydratedDocument<UserDoc>) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl,
    initials: initials(user.name),
  };
}

function issueSessionCookie(res: Response, user: HydratedDocument<UserDoc>) {
  const token = signSession({ sub: user.id, email: user.email, role: user.role });
  res.cookie(SESSION_COOKIE_NAME, token, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
  return token;
}

/**
 * Step 1 of the OAuth code flow — redirects the browser to Google's consent
 * screen. Requires GOOGLE_CLIENT_ID to be set; until then this 501s so the
 * frontend can fall back to /auth/dev-login.
 */
authRouter.get(
  "/google",
  asyncHandler(async (_req, res) => {
    if (!isGoogleOAuthConfigured) {
      throw new ApiError(
        501,
        "Google OAuth chưa được cấu hình — thiếu GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET. Dùng /auth/dev-login để test tạm.",
      );
    }

    const state = randomBytes(16).toString("hex");
    res.cookie(STATE_COOKIE_NAME, state, { ...cookieOptions, maxAge: 10 * 60 * 1000 });

    const params = new URLSearchParams({
      client_id: env.googleClientId,
      redirect_uri: env.googleRedirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  }),
);

/** Step 2 — Google redirects back here with a one-time code. */
authRouter.get(
  "/google/callback",
  requireDb,
  asyncHandler(async (req, res) => {
    const { code, state } = req.query as { code?: string; state?: string };
    const expectedState = req.cookies?.[STATE_COOKIE_NAME];
    res.clearCookie(STATE_COOKIE_NAME, { path: "/" });

    if (!code || !state || state !== expectedState) {
      return res.redirect(env.frontendLoginFailureUrl);
    }

    try {
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: env.googleClientId,
          client_secret: env.googleClientSecret,
          redirect_uri: env.googleRedirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) throw new Error(`token exchange failed: ${await tokenRes.text()}`);
      const tokenBody = (await tokenRes.json()) as { access_token: string };

      const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
      });
      if (!profileRes.ok) throw new Error("failed to fetch google userinfo");
      const profile = (await profileRes.json()) as {
        sub: string;
        email: string;
        name: string;
        picture?: string;
      };

      const user = await User.findOneAndUpdate(
        { email: profile.email.toLowerCase() },
        { name: profile.name, avatarUrl: profile.picture, googleId: profile.sub },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      issueSessionCookie(res, user);
      res.redirect(env.frontendLoginSuccessUrl);
    } catch (err) {
      console.error("Google OAuth callback failed:", err);
      res.redirect(env.frontendLoginFailureUrl);
    }
  }),
);

const devLoginSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).default("Khách demo"),
});

/**
 * Dev-only login bypass so the frontend/API can be exercised before real
 * Google OAuth credentials are issued. Disabled by clearing ALLOW_DEV_LOGIN.
 */
authRouter.post(
  "/dev-login",
  requireDb,
  asyncHandler(async (req, res) => {
    if (!env.allowDevLogin) {
      throw ApiError.forbidden("Dev login đang bị tắt (ALLOW_DEV_LOGIN=false).");
    }
    const { email, name } = devLoginSchema.parse(req.body);

    const user = await User.findOneAndUpdate(
      { email: email.toLowerCase() },
      { $setOnInsert: { name, email: email.toLowerCase() } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    issueSessionCookie(res, user);
    res.json({ user: toPublicUser(user) });
  }),
);

authRouter.get(
  "/me",
  requireDb,
  attachUser,
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user!.sub);
    if (!user) throw ApiError.unauthorized();
    res.json({ user: toPublicUser(user) });
  }),
);

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
  res.status(204).end();
});
