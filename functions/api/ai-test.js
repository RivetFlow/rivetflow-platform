
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

    const prompt = `
You are RivetFlow AI, a professional business assistant
built for contractors and home-service companies.

YOUR RULES:
- Answer only the user's actual question.
- Stay focused on roofing, contractors, sales and business operations when relevant.
- Never introduce unrelated subjects.
- Do not invent previous conversations or instructions.
- Do not repeat the user's question.
- Use clear, natural, professional language.
- Give practical advice that can actually be used.
- Keep answers concise unless more detail is requested.

USER REQUEST:
${message.trim()}

Write your answer now. Follow the request exactly.
`;

    const result = await env.AI.run(
      "@cf/zai-org/glm-4.7-flash",
      {
        prompt,
        max_completion_tokens: 512,
        temperature: 0.3
      }
    );

    const reply =
      result?.choices?.[0]?.text ??
      result?.choices?.[0]?.message?.content ??
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
