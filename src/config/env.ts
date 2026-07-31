import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),

  // MongoDB Atlas connection string — left empty until the key is issued.
  // Format once provided: mongodb+srv://<user>:<password>@<cluster>.mongodb.net/<db>?retryWrites=true&w=majority
  MONGODB_URI: z.string().default(""),

  JWT_SECRET: z.string().min(1).default("dev-only-change-me"),
  JWT_EXPIRES_IN: z.string().default("7d"),

  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z.string().default("http://localhost:4000/auth/google/callback"),
  FRONTEND_LOGIN_SUCCESS_URL: z.string().default("http://localhost:3000"),
  FRONTEND_LOGIN_FAILURE_URL: z.string().default("http://localhost:3000?login=failed"),

  ALLOW_DEV_LOGIN: z
    .string()
    .default("true")
    .transform((v) => v === "true"),

  CLOUDINARY_CLOUD_NAME: z.string().default(""),
  CLOUDINARY_API_KEY: z.string().default(""),
  CLOUDINARY_API_SECRET: z.string().default(""),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  nodeEnv: raw.NODE_ENV,
  port: raw.PORT,
  corsOrigin: raw.CORS_ORIGIN,

  mongodbUri: raw.MONGODB_URI,

  jwtSecret: raw.JWT_SECRET,
  jwtExpiresIn: raw.JWT_EXPIRES_IN,

  googleClientId: raw.GOOGLE_CLIENT_ID,
  googleClientSecret: raw.GOOGLE_CLIENT_SECRET,
  googleRedirectUri: raw.GOOGLE_REDIRECT_URI,
  frontendLoginSuccessUrl: raw.FRONTEND_LOGIN_SUCCESS_URL,
  frontendLoginFailureUrl: raw.FRONTEND_LOGIN_FAILURE_URL,

  allowDevLogin: raw.ALLOW_DEV_LOGIN,

  cloudinaryCloudName: raw.CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey: raw.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: raw.CLOUDINARY_API_SECRET,
};

export const isGoogleOAuthConfigured = Boolean(env.googleClientId && env.googleClientSecret);
export const isMongoConfigured = Boolean(env.mongodbUri);
export const isCloudinaryConfigured = Boolean(
  env.cloudinaryCloudName && env.cloudinaryApiKey && env.cloudinaryApiSecret,
);
