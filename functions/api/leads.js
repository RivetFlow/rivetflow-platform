
import { requireTenant } from "../_lib/tenant.js";

function jsonResponse(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

function cleanText(value, maxLength = 2000) {
  if (typeof value !== "string") return null;

  const cleaned = value.trim().slice(0, maxLength);

  return cleaned || null;
}

function cleanPriority(value) {
  const allowed = ["low", "normal", "high", "urgent"];
  const priority = String(value || "normal").toLowerCase();

  return allowed.includes(priority) ? priority : "normal";
}

function cleanFollowUpCompleted(value) {
  if (value === true || value === 1 || value === "1") return 1;
  if (value === false || value === 0 || value === "0") return 0;

  return null;
}

async function readRequestBody(request) {
  try {
    const data = await request.json();

    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data)
    ) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

export async function onRequestGet({ request, env }) {
  try {
    const access = await requireTenant(request, env);

    if (!access.ok) return access.response;

    const result = await env.DB.prepare(
      `SELECT *
       FROM leads
       WHERE tenant_id = ?
       ORDER BY created_at DESC`
    ).bind(access.tenantId).all();

    return jsonResponse(result.results || []);
  } catch (error) {
    return jsonResponse(
      { error: "Could not retrieve leads" },
      500
    );
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const access = await requireTenant(request, env);

    if (!access.ok) return access.response;

    const data = await readRequestBody(request);

    if (!data) {
      return jsonResponse(
        { error: "A valid JSON object is required" },
        400
      );
    }

    const customerName = cleanText(data.customer_name, 200);
    const service = cleanText(data.service, 300);

    if (!customerName || !service) {
      return jsonResponse(
        { error: "Customer name and service are required" },
        400
      );
    }

    const tenantId = access.tenantId;
    const id = crypto.randomUUID();

    const priority = cleanPriority(data.priority);
    const category = cleanText(data.category, 150) || "general";
    const followUpAt = cleanText(data.follow_up_at, 100);
    const aiSummary = cleanText(data.ai_summary, 2000);
    const nextAction = cleanText(data.next_action, 1000);

    await env.DB.prepare(
      `INSERT INTO leads (
        id,
        tenant_id,
        customer_name,
        email,
        phone,
        service,
        message,
        status,
        priority,
        category,
        follow_up_at,
        ai_summary,
        next_action
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      tenantId,
      customerName,
      cleanText(data.email, 300),
      cleanText(data.phone, 100),
      service,
      cleanText(data.message, 4000),
      "New",
      priority,
      category,
      followUpAt,
      aiSummary,
      nextAction
    ).run();

    return jsonResponse(
      {
        success: true,
        id,
        priority,
        category,
        follow_up_completed: 0
      },
      201
    );
  } catch (error) {
    return jsonResponse(
      { error: "Could not save lead" },
      500
    );
  }
}

export async function onRequestPatch({ request, env }) {
  try {
    const access = await requireTenant(request, env);

    if (!access.ok) return access.response;

    const data = await readRequestBody(request);

    if (!data) {
      return jsonResponse(
        { error: "A valid JSON object is required" },
        400
      );
    }

    const id = cleanText(data.id, 100);

    if (!id) {
      return jsonResponse(
        { error: "Lead ID is required" },
        400
      );
    }

    const allowedStatuses = [
      "New",
      "Contacted",
      "Booked",
      "Closed"
    ];

    const updates = [];
    const values = [];

    if (data.status !== undefined) {
      if (
        typeof data.status !== "string" ||
        !allowedStatuses.includes(data.status)
      ) {
        return jsonResponse(
          { error: "Invalid lead status" },
          400
        );
      }

      updates.push("status = ?");
      values.push(data.status);
    }

    if (data.priority !== undefined) {
      updates.push("priority = ?");
      values.push(cleanPriority(data.priority));
    }

    if (data.category !== undefined) {
      updates.push("category = ?");
      values.push(cleanText(data.category, 150) || "general");
    }

    if (data.follow_up_at !== undefined) {
      updates.push("follow_up_at = ?");
      values.push(cleanText(data.follow_up_at, 100));
    }

    if (data.ai_summary !== undefined) {
      updates.push("ai_summary = ?");
      values.push(cleanText(data.ai_summary, 2000));
    }

    if (data.next_action !== undefined) {
      updates.push("next_action = ?");
      values.push(cleanText(data.next_action, 1000));
    }

    if (data.follow_up_completed !== undefined) {
      const completed = cleanFollowUpCompleted(
        data.follow_up_completed
      );

      if (completed === null) {
        return jsonResponse(
          {
            error: "Follow-up completion must be true, false, 1 or 0"
          },
          400
        );
      }

      updates.push("follow_up_completed = ?");
      values.push(completed);
    }

    if (updates.length === 0) {
      return jsonResponse(
        { error: "No valid updates were provided" },
        400
      );
    }

    values.push(id, access.tenantId);

    const result = await env.DB.prepare(
      `UPDATE leads
       SET ${updates.join(", ")}
       WHERE id = ? AND tenant_id = ?`
    ).bind(...values).run();

    return jsonResponse({
      success: true,
      changes: result.meta.changes
    });
  } catch (error) {
    return jsonResponse(
      { error: "Could not update lead" },
      500
    );
  }
}
