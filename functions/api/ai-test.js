
const ALLOWED_ORIGIN = "https://hoppscotch.io";

function corsHeaders(request) {
  const origin = request.headers.get("Origin");

  const headers = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
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
    const expectedKey = env.RIVETFLOW_TEST_KEY;
    const suppliedKey = request.headers.get("Authorization");

    if (!expectedKey) {
      return Response.json(
        { error: "Server configuration: test secret is missing." },
        { status: 500, headers }
      );
    }

    if (!suppliedKey) {
      return Response.json(
        { error: "Authorization header is missing." },
        { status: 401, headers }
      );
    }

    if (suppliedKey !== `Bearer ${expectedKey}`) {
      return Response.json(
        { error: "Authorization key does not match." },
        { status: 401, headers }
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
      "@cf/google/gemma-4-26b-a4b-it",
      {
        prompt:
          "You are RivetFlow AI, a helpful assistant for contractors. " +
          "Give clear, practical answers.\n\n" +
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
      { error: "The AI request could not be completed." },
      { status: 500, headers }
    );
  }
}
