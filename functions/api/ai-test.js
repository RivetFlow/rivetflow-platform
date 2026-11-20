
export async function onRequestPost({ request, env }) {
  try {
    if (!env.AI) {
      return Response.json(
        { success: false, error: "AI connection is missing." },
        { status: 500 }
      );
    }

    const body = await request.json();
    const message = body?.message;

    if (typeof message !== "string" || !message.trim()) {
      return Response.json(
        { success: false, error: "Please provide a message." },
        { status: 400 }
      );
    }

    if (message.length > 1500) {
      return Response.json(
        { success: false, error: "Message is too long." },
        { status: 400 }
      );
    }

    const result = await env.AI.run(
      "@cf/zai-org/glm-4.7-flash",
      {
        prompt:
          "You are RivetFlow AI, a professional AI assistant for contractors. " +
          "Give clear, practical, useful answers. Be concise but explain your reasoning when helpful.\n\n" +
          "User message: " + message.trim(),
        max_tokens: 256
      }
    );

    const reply =
      result?.choices?.[0]?.text ??
      result?.response ??
      "";

    if (!reply.trim()) {
      return Response.json(
        { success: false, error: "The AI returned an empty response." },
        { status: 502 }
      );
    }

    return Response.json({
      success: true,
      reply: reply.trim(),
      model: "@cf/zai-org/glm-4.7-flash"
    });

  } catch (error) {
    return Response.json(
      { success: false, error: "The AI request could not be completed." },
      { status: 500 }
    );
  }
}
