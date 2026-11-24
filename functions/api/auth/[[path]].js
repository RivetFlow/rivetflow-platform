
import { createAuth } from "../../_lib/auth.js";

export async function onRequest(context) {
  try {
    console.log("[RivetFlow Auth Route] Request received.");

    const auth = createAuth(context.env);
    const response = await auth.handler(context.request);

    if (response.status >= 500) {
      const details = await response.clone().text();

      console.error(
        "[RivetFlow Auth Route] Server error:",
        response.status,
        details.slice(0, 2000)
      );
    }

    return response;

  } catch (error) {
    console.error(
      "[RivetFlow Auth Route] Runtime exception:",
      error?.stack || error?.message || String(error)
    );

    return Response.json(
      { error: "Authentication service failed." },
      { status: 500 }
    );
  }
}
