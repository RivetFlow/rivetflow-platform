
import { requireTenant } from "../_lib/tenant.js";

const MODEL = "@cf/zai-org/glm-4.7-flash";

function jsonResponse(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function cleanText(value, maxLength = 1000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function parseList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? parsed.filter(item => typeof item === "string").slice(0, 15)
      : [];
  } catch {
    return [];
  }
}

function parseAIJson(raw) {
  const cleaned = String(raw || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end <= start) {
    throw new Error("AI returned invalid JSON.");
  }

  return JSON.parse(cleaned.slice(start, end + 1));
}

function calculateDate(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getDays(priority) {
  return {
    urgent: 0,
    high: 1,
    normal: 3,
    low: 7,
  }[priority] ?? 3;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204 });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.AI) {
      return jsonResponse({
        success: false,
        error: "Database or AI service is unavailable.",
      }, 500);
    }

    const access = await requireTenant(request, env);

    if (!access.ok) return access.response;

    const body = await request.json();
    const leadId = cleanText(body.leadId, 100);

    if (!leadId) {
      return jsonResponse({
        success: false,
        error: "A lead ID is required.",
      }, 400);
    }

    const lead = await env.DB.prepare(`
      SELECT
        id,
        customer_name,
        email,
        phone,
        service,
        message,
        status,
        priority,
        category,
        ai_summary,
        next_action,
        follow_up_at
      FROM leads
      WHERE id = ? AND tenant_id = ?
      LIMIT 1
    `).bind(leadId, access.tenantId).first();

    if (!lead) {
      return jsonResponse({
        success: false,
        error: "Lead not found.",
      }, 404);
    }

    const business = await env.DB.prepare(`
      SELECT
        t.business_name,
        p.industry,
        p.description,
        p.services,
        p.service_area,
        p.tone,
        p.goals,
        p.policies
      FROM tenants t
      LEFT JOIN business_profiles p
        ON p.tenant_id = t.id
      WHERE t.id = ?
      LIMIT 1
    `).bind(access.tenantId).first();

    if (!business) {
      return jsonResponse({
        success: false,
        error: "Business profile not found.",
      }, 404);
    }

    const services = parseList(business.services);
    const policies = parseList(business.policies);

    const prompt = `
You are RivetFlow AI's CRM follow-up assistant.

Create a practical follow-up recommendation for this business owner.

BUSINESS:
${cleanText(business.business_name, 120)}

INDUSTRY:
${cleanText(business.industry, 120) || "General business"}

DESCRIPTION:
${cleanText(business.description, 500)}

SERVICES:
${services.join("; ") || "Not specified"}

SERVICE AREA:
${cleanText(business.service_area, 200) || "Not specified"}

COMMUNICATION STYLE:
${cleanText(business.tone, 150) || "Professional and friendly"}

BUSINESS GOALS:
${cleanText(business.goals, 300)}

POLICIES:
${policies.join("; ") || "Not specified"}

LEAD:
Customer: ${cleanText(lead.customer_name, 120)}
Service requested: ${cleanText(lead.service, 200)}
Customer message: ${cleanText(lead.message, 1500)}
AI summary: ${cleanText(lead.ai_summary, 1000)}
Current status: ${cleanText(lead.status, 50)}
Current priority: ${cleanText(lead.priority, 30)}
Category: ${cleanText(lead.category, 100)}

INSTRUCTIONS:

1. Recommend one clear, useful next action.
2. Explain briefly why this action is appropriate.
3. Recommend a follow-up date based on urgency.
4. Write a natural, personalized message the business owner
   can review and send.
5. Do not invent prices, appointments, availability,
   promises, qualifications or customer details.
6. Do not claim a message has been sent.
7. Adapt to the actual industry. Do not assume this is
   a construction or home-service business.
8. Do not ask for a service address unless relevant.
9. Keep the message professional, concise and human.
10. Never include private internal analysis.

Return ONLY valid JSON using this exact structure:

{
  "priority": "normal",
  "reason": "Short explanation of priority",
  "nextAction": "Recommended next action",
  "followUpDays": 3,
  "followUpDate": "YYYY-MM-DD",
  "message": "Personalized customer follow-up message"
}

Priority must be low, normal, high or urgent.
followUpDays must be an integer from 0 to 14.
Use 0 for same-day follow-up.
The follow-up date must be calculated from today's date.
Today's date is ${new Date().toISOString().slice(0, 10)}.
`;

    const result = await env.AI.run(MODEL, {
      messages: [
        {
          role: "system",
          content: "You are a precise business CRM assistant. Return valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_completion_tokens: 700,
      temperature: 0.2,
      chat_template_kwargs: {
        enable_thinking: false,
        clear_thinking: true,
      },
    });

    const raw =
      result?.choices?.[0]?.message?.content ??
      result?.choices?.[0]?.text ??
      result?.response ??
      "";

    const recommendation = parseAIJson(raw);

    const allowedPriorities = ["low", "normal", "high", "urgent"];

    const priority = allowedPriorities.includes(
      String(recommendation.priority).toLowerCase()
    )
      ? String(recommendation.priority).toLowerCase()
      : "normal";

    const days = Number.isInteger(recommendation.followUpDays)
      ? Math.max(0, Math.min(14, recommendation.followUpDays))
      : getDays(priority);

    const followUpDate = calculateDate(days);

    const nextAction = cleanText(
      recommendation.nextAction,
      500
    );

    const reason = cleanText(
      recommendation.reason,
      500
    );

    const message = cleanText(
      recommendation.message,
      1500
    );

    if (!nextAction || !message) {
      throw new Error("AI recommendation was incomplete.");
    }

    await env.DB.prepare(`
      UPDATE leads
      SET
        priority = ?,
        next_action = ?,
        follow_up_at = ?,
        follow_up_message = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(
      priority,
      nextAction,
      followUpDate,
      message,
      leadId,
      access.tenantId
    ).run();

    return jsonResponse({
      success: true,
      recommendation: {
        priority,
        reason,
        nextAction,
        followUpDays: days,
        followUpDate,
        message,
      },
    });

  } catch (error) {
    console.error("RivetFlow follow-up error:", error);

    return jsonResponse({
      success: false,
      error: "Could not generate the AI follow-up recommendation.",
    }, 500);
  }
}
