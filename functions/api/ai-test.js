export async function onRequestPost({ request, env }) {
  try {
    const { message } = await request.json();

    if (!message || typeof message !== "string") {
      return Response.json(
        { error: "Please provide a message." },
        { status: 400 }
      );
    }

    if (message.length > 2000) {
      return Response.json(
        { error: "Message is too long." },
        { status: 400 }
      );
    }

    const result = await env.AI.run(
      "@cf/meta/llama-3.1-8b-instruct",
      {
        prompt: `You are RivetFlow AI, a helpful assistant for contractors.

User message: ${message}

Give a clear, practical answer.`
      }
    );

    return Response.json({
      success: true,
      reply: result.response
    });

  } catch (error) {
    return Response.json(
      { error: "The AI request could not be completed." },
      { status: 500 }
    );
  }
}
