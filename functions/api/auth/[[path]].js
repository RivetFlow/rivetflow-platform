
import { createAuth } from "../../_lib/auth.js";

export async function onRequest(context) {
  const request = context.request;
  const url = new URL(request.url);

  try {
    console.log(
      "[RivetFlow Auth Route] Request:",
      request.method,
      url.pathname
    );

    const auth = createAuth(context.env);
    const response = await auth.handler(request);

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
          details: details || "No response details returned.",
          diagnostic: "Check Cloudflare runtime logs."
        },
        {
          status: response.status,
          headers: {
            "Cache-Control": "no-store"
          }
        }
      );
    }

    return response;

  } catch (error) {
    console.error("[RivetFlow Auth Route] Runtime exception:", {
      name: error?.name,
      message: error?.message,
      stack: error?.stack
    });

    return Response.json(
      {
        error: "Authentication runtime exception.",
        name: error?.name || "UnknownError",
        details: error?.message || String(error)
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }
}
