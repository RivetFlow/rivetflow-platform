export async function onRequestPost({ request, env }) {
  try {
    const suppliedKey = request.headers.get("Authorization");
    const expectedKey = env.RIVETFLOW_TEST_KEY;

    if (!expectedKey || suppliedKey !== `Bearer ${expectedKey}`) {
      return Response.json(
        { error: "Unauthorized." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const message = body?.message;

    if (typeof message !== "string" || !message.trim()) {
      return Response.json(
        { error: "Please provide a message." },
        { status: 400 }
      );
    }

    if (message.length > 1500) {
      return Response.json(
        { error: "Message is too long. Maximum is 1500 characters." },
        { status: 400 }
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

    return Response.json({
      success: true,
      reply: result.response ?? result
    });

  } catch (error) {
    return Response.json(
      { error: "The AI request could not be completed." },
      { status: 500 }
    );
  }
}
