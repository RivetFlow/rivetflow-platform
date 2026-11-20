 
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

function cleanReply(text) {
  if (typeof text !== "string") return "";

  let lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);

  const seen = new Set();
  const cleaned = [];

  for (const line of lines) {
    const normalized = line
      .replace(/^#+\s*/, "")
      .replace(/\*\*/g, "")
      .toLowerCase();

    if (seen.has(normalized)) continue;

    seen.add(normalized);
    cleaned.push(line);
  }

  return cleaned.join("\n").trim();
}

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

    const prompt = `You are RivetFlow AI, a professional assistant for contractors and home-service businesses.

Answer the user's question directly.

Rules:
- Give one complete answer only.
- Never repeat sentences, paragraphs, or headings.
- Do not write the word "Answer:" as a heading.
- Do not repeat the question.
- Do not add a sales pitch or call to action unless requested.
- Use clear, natural language.
- Use short paragraphs or a short numbered list when helpful.
- Keep the answer under 180 words unless the user requests more detail.
- Never recommend unsafe roof repairs, such as climbing onto a wet or storm-damaged roof or securing plastic with nails.

User question:
${message.trim()}`;

    const result = await env.AI.run(
      "@cf/zai-org/glm-4.7-flash",
      {
        prompt,
        max_tokens: 256,
        temperature: 0.2
      }
    );

    const rawReply =
      result?.choices?.[0]?.text ??
      result?.choices?.[0]?.message?.content ??
      result?.response ??
      "";

    const reply = cleanReply(rawReply);

    if (!reply) {
      return Response.json(
        { success: false, error: "The AI returned an empty response. Please try again." },
        { status: 502, headers: corsHeaders }
      );
    }

    return Response.json(
      {
        success: true,
        reply,
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
