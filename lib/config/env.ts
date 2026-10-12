import { z } from "zod";

/**
 * All configuration comes from env vars (see .env.example). Nothing secret has a default.
 * MOCK_MODE is forced on whenever the keys a subsystem needs are missing, so the app always runs.
 */
const bool = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

const EnvZ = z.object({
  MOCK_MODE: bool,
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  GEMINI_DAILY_CALL_BUDGET: z.coerce.number().int().nonnegative().default(400),
  GEMINI_DAILY_GROUNDED_BUDGET: z.coerce.number().int().nonnegative().default(160),
  GEMINI_GROUNDING_ENABLED: z.string().optional().transform((v) => v !== "false"),
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  SPOTIFY_REDIRECT_URI: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  FROM_EMAIL: z.string().optional(),
  ALERT_EMAIL: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  HOME_CITY: z.string().default("Bengaluru"),
  BANDSINTOWN_APP_ID: z.string().optional(),
  TICKETMASTER_API_KEY: z.string().optional(),
  GOOGLE_NEWS_RSS_ENABLED: bool,
  HTTP_USER_AGENT: z.string().default("LiveShowRadar/1.0 (+https://github.com/; personal concert alerts; robots-respecting)"),
});

export type Env = z.infer<typeof EnvZ>;

let cached: Env | null = null;
export function env(): Env {
  if (!cached) cached = EnvZ.parse(process.env);
  return cached;
}
/** Tests only. */
export function resetEnv() {
  cached = null;
}

export const isMock = () => env().MOCK_MODE;
export const hasDb = () => !isMock() && !!env().SUPABASE_URL && !!env().SUPABASE_SERVICE_ROLE_KEY;
export const hasGemini = () => !isMock() && !!env().GEMINI_API_KEY;
export const hasTelegram = () => !isMock() && !!env().TELEGRAM_BOT_TOKEN && !!env().TELEGRAM_CHAT_ID;
export const hasEmail = () => !isMock() && !!env().RESEND_API_KEY && !!env().FROM_EMAIL && !!env().ALERT_EMAIL;
export const hasSpotify = () => !!env().SPOTIFY_CLIENT_ID && !!env().SPOTIFY_REDIRECT_URI;
