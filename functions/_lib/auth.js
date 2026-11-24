import { betterAuth } from "better-auth";

const DEFAULT_APP_URL = "https://rivetflow-platform.pages.dev";

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
