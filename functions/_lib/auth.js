
import { betterAuth } from "better-auth";

const DEFAULT_APP_URL = "https://rivetflow-platform.pages.dev";

function cleanBusinessName(name) {
  const cleaned = String(name || "My")
    .trim()
    .slice(0, 100);

  return `${cleaned}'s Business`;
}

function generatePublicKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sendEmail(env, to, subject, html) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "RivetFlow <notifications@rivetflowtechnologies.com>",
      to: [to],
      subject,
      html
    })
  });

  if (!response.ok) {
    throw new Error("Email delivery failed.");
  }
}

export function createAuth(env) {
  const appUrl = env.BETTER_AUTH_URL || DEFAULT_APP_URL;

  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: appUrl,
    trustedOrigins: [appUrl],

    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const tenantId = crypto.randomUUID();
            const membershipId = crypto.randomUUID();
            const publicKey = generatePublicKey();
            const businessName = cleanBusinessName(user.name);

            await env.DB.batch([
              env.DB.prepare(
                `INSERT INTO tenants (
                  id, business_name, public_key
                ) VALUES (?, ?, ?)`
              ).bind(
                tenantId,
                businessName,
                publicKey
              ),

              env.DB.prepare(
                `INSERT INTO tenant_members (
                  id, user_id, tenant_id, role
                ) VALUES (?, ?, ?, ?)`
              ).bind(
                membershipId,
                user.id,
                tenantId,
                "owner"
              )
            ]);
          }
        }
      }
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,

      sendResetPassword: async ({ user, url }) => {
        await sendEmail(
          env,
          user.email,
          "Reset your RivetFlow password",
          `<p>Reset your password using the link below:</p>
           <p><a href="${url}">Reset Password</a></p>`
        );
      }
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,

      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(
          env,
          user.email,
          "Verify your RivetFlow account",
          `<h2>Welcome to RivetFlow!</h2>
           <p>Please verify your email address:</p>
           <p><a href="${url}">Verify Email Address</a></p>`
        );
      }
    }
  });
}
