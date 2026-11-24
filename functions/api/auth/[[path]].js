
import { createAuth } from "../../_lib/auth.js";

export async function onRequest(context) {
  try {
    console.log("[RivetFlow Auth Route] Request received:", context.request.method, new URL(context.request.url).pathname);

    const auth = createAuth(context.env);
    const response = await auth.handler(context.request);

    if (response.status >= 500) {
      const details = await response.clone().text().catch(() => "");

      console.error("[RivetFlow Auth Route] Better Auth error:", {
        status: response.status,
        details
      });

      return Response.json(
        {
          error: "Better Auth returned a server error.",
          status: response.status,
          details: details || "Better Auth returned no error details."
        },
        {
          status: response.status,
          headers: { "Cache-Control": "no-store" }
        }
      );
    }

    return response;

  } catch (error) {
    console.error(
      "[RivetFlow Auth Route] Runtime exception:",
      error?.stack || error?.message || String(error)
    );

    return Response.json(
      {
        error: "Authentication runtime exception.",
        details: error?.message || String(error)
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}
