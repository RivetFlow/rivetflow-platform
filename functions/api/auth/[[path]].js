
import { createAuth } from "../../_lib/auth.js";

function errorResponse(message, status = 500) {
  return Response.json(
    {
      success: false,
      error: message
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}

export async function onRequest(context) {
  const request = context.request;

  try {
    const auth = createAuth(context.env);
    const response = await auth.handler(request);

    if (response.status >= 500) {
      console.error(
        "[RivetFlow Auth Route] Authentication service error:",
        response.status,
        request.method,
        new URL(request.url).pathname
      );

      return errorResponse(
        "An authentication error occurred. Please try again.",
        response.status
      );
    }

    return response;

  } catch (error) {
    console.error(
      "[RivetFlow Auth Route] Runtime exception:",
      error?.name || "UnknownError"
    );

    return errorResponse(
      "Authentication is temporarily unavailable.",
      500
    );
  }
}
