
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";

const DEFAULT_APP_URL = "https://rivetflow-platform.pages.dev";

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return Response.json(
      { error: "POST required." },
      { status: 405 }
    );
  }

  const secret = env.BETTER_AUTH_SECRET;
  const supplied = request.headers.get("Authorization");

  if (!secret || supplied !== `Bearer ${secret}`) {
    return Response.json(
      { error: "Unauthorized." },
      { status: 401 }
    );
  }

  try {
    const appUrl = env.BETTER_AUTH_URL || DEFAULT_APP_URL;

    const auth = betterAuth({
      database: env.DB,
      secret,
      baseURL: appUrl,
      trustedOrigins: [appUrl],

      emailAndPassword: {
        enabled: true,
        requireEmailVerification: true,

        sendResetPassword: async () => {
          throw new Error("Password reset is not configured for migration.");
        }
      },

      emailVerification: {
        sendOnSignUp: true,
        autoSignInAfterVerification: true,

        sendVerificationEmail: async () => {
          throw new Error("Email verification is not configured for migration.");
        }
      }
    });

    const { toBeCreated, toBeAdded, runMigrations } =
      await getMigrations(auth.options);

    if (toBeCreated.length === 0 && toBeAdded.length === 0) {
      return Response.json({
        success: true,
        message: "No migrations needed."
      });
    }

    await runMigrations();

    return Response.json({
      success: true,
      message: "Authentication tables created.",
      created: toBeCreated.map(item => item.table),
      added: toBeAdded.map(item => item.table)
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error.message || "Migration failed." },
      { status: 500 }
    );
  }
}
