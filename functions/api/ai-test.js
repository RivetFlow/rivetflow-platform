
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.AI) {
      return Response.json(
        { success: false, error: "AI connection is missing." },
        { status: 500, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const message = body?.message;

    if (typeof message !== "string" || !message.trim()) {
      return Response.json(
        { success: false, error: "Please provide a message." },
        { status: 400, headers: corsHeaders }
      );
    }

    if (message.length > 1500) {
      return Response.json(
        { success: false, error: "Message is too long." },
        { status: 400, headers: corsHeaders }
      );
    }

    const result = await env.AI.run(
      "@cf/zai-org/glm-4.7-flash",
      {
        prompt:
          "You are RivetFlow AI, a professional AI assistant for contractors. " +
          "Give clear, practical, useful answers.\n\n" +
          "User message: " + message.trim(),
        max_tokens: 256
      }
    );

    const reply =
      result?.choices?.[0]?.text ??
      result?.response ??
      "";

    if (typeof reply !== "string" || !reply.trim()) {
      return Response.json(
        { success: false, error: "The AI returned an empty response." },
        { status: 502, headers: corsHeaders }
      );
    }

    return Response.json(
      {
        success: true,
        reply: reply.trim(),
        model: "@cf/zai-org/glm-4.7-flash"
      },
      { status: 200, headers: corsHeaders }
    );

  } catch (error) {
    return Response.json(
      { success: false, error: "The AI request could not be completed." },
      { status: 500, headers: corsHeaders }
    );
  }
}
