
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

// Handle the browser's preliminary security request
export async function onRequestOptions({ request }) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request)
  });
}

// Handle the actual AI request
export async function onRequestPost({ request, env }) {
  const headers = corsHeaders(request);

  try {
    const suppliedKey = request.headers.get("Authorization");
    const expectedKey = env.RIVETFLOW_TEST_KEY;

    if (!expectedKey || suppliedKey !== `Bearer ${expectedKey}`) {
      return Response.json(
        { error: "Unauthorized." },
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
        { error: "Message is too long. Maximum is 1500 characters." },
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
