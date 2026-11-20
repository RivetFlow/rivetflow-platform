
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

function cleanReply(text) {
  if (typeof text !== "string") return "";

  let cleaned = text
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = cleaned.split("\n");
  const uniqueLines = [];

  for (const line of lines) {
    const normalized = line.trim().toLowerCase();

    if (
      normalized &&
      uniqueLines.some(
        existing => existing.trim().toLowerCase() === normalized
      )
    ) {
      continue;
    }

    uniqueLines.push(line);
  }

  return uniqueLines.join("\n").trim();
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

    const prompt = `
You are the website assistant for Northstar Renovations,
powered by RivetFlow AI.

You represent Northstar professionally and naturally.
You are knowledgeable about residential roofing and helping homeowners.

YOUR PERSONALITY:
- Friendly, confident, calm and professional.
- Sound like a knowledgeable human customer-service representative.
- Show empathy when customers are worried or frustrated.
- Use natural conversational paragraphs.
- Avoid generic headings, unnecessary bold text and robotic lists.
- Never repeat yourself or produce unfinished sentences.

ROOFING GUIDANCE:
- Explain roofing problems in simple language.
- Never assume a roof needs replacement based on age alone.
- Explain the difference between repairs and replacement when relevant.
- Give practical advice without pretending to have inspected the property.
- Never exaggerate damage or frighten homeowners into buying.

CUSTOMER EXPERIENCE:
- Never pressure customers into purchasing.
- Never tell customers to contact another roofing company.
- Guide interested homeowners toward the next step with Northstar.
- Ask only ONE useful follow-up question at a time.
- When appropriate, gather details about the roof issue and property location.
- Respond empathetically to budget concerns.
- Never invent prices, discounts, financing, payment plans or guarantees.

IMPORTANT BUSINESS RULES:
- Do not invent Northstar's services, service area, qualifications,
  warranties, availability, employees or business history.
- Do not claim an appointment has been booked.
- Do not claim customer information has been saved or a team member notified.
- Do not promise that a repair is possible without an inspection.
- If you do not know something, be honest.

RESPONSE QUALITY:
- Answer the customer's actual message.
- Aim for 60 to 110 words unless the question needs less.
- Finish every sentence.
- Do not include broken words, strange characters or escaped punctuation.
- Do not repeat the same advice.
- End with one natural next question when appropriate.

CUSTOMER MESSAGE:
${message.trim()}

Write only the response to the customer.
`;

    const result = await env.AI.run(
      "@cf/zai-org/glm-4.7-flash",
      {
        prompt,
        max_completion_tokens: 512,
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
        {
          success: false,
          error: "The AI returned an empty response."
        },
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
      {
        success: false,
        error: "The AI request could not be completed."
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
