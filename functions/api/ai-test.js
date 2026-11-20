
const ALLOWED_ORIGIN = "https://hoppscotch.io";

function corsHeaders(request) {
  const origin = request.headers.get("Origin");

  const headers = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };

  if (origin === ALLOWED_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN;
  }

  return headers;
}

export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request)
  });
}

export async function onRequestPost({ request, env }) {
  const headers = corsHeaders(request);

  try {
    if (!env.AI) {
      return Response.json(
        { error: "Workers AI binding is missing." },
        { status: 500, headers }
      );
    }

    const body = await request.json();
    const message = body?.message;

    if (typeof message !== "string" || !message.trim()) {
      return Response.json(
        { error: "Please provide a message." },
        { status: 400, headers }
      );
    }

    if (message.length > 1500) {
      return Response.json(
        { error: "Message is too long." },
        { status: 400, headers }
      );
    }

    const result = await env.AI.run(
      "@cf/zai-org/glm-4.7-flash",
      {
        prompt:
          "You are RivetFlow AI, an intelligent assistant " +
          "for contractors. Give practical, clear and " +
          "professional answers.\n\n" +
          "User message: " + message.trim()
      }
    );

    return Response.json(
      {
        success: true,
        reply: result.response ?? result
      },
      { status: 200, headers }
    );

  } catch (error) {
    return Response.json(
      { error: "AI request failed. Check the Workers AI model and binding." },
      { status: 500, headers }
    );
  }
}
