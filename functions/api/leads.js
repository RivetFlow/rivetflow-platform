
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

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);

    const tenantId =
      url.searchParams.get("tenantId") ||
      url.searchParams.get("tenant_id");

    if (!tenantId) {
      return Response.json(
        { error: "Tenant ID is required" },
        { status: 400 }
      );
    }

    const result = await env.DB.prepare(
      `SELECT *
       FROM leads
       WHERE tenant_id = ?
       ORDER BY created_at DESC`
    ).bind(tenantId).all();

    return Response.json(result.results || []);
  } catch (error) {
    return Response.json(
      { error: "Could not retrieve leads" },
      { status: 500 }
    );
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const data = await request.json();

    const tenantId = data.tenantId || data.tenant_id;

    const customerName = cleanText(data.customer_name, 200);
    const service = cleanText(data.service, 300);

    if (!customerName || !tenantId || !service) {
      return Response.json(
        {
          error: "Customer name, tenant ID and service are required"
        },
        { status: 400 }
      );
    }

    const tenant = await env.DB.prepare(
      "SELECT id FROM tenants WHERE id = ?"
    ).bind(tenantId).first();

    if (!tenant) {
      return Response.json(
        { error: "Tenant not found" },
        { status: 404 }
      );
    }

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

    return Response.json(
      {
        success: true,
        id,
        priority,
        category,
        follow_up_completed: 0
      },
      { status: 201 }
    );
  } catch (error) {
    return Response.json(
      { error: "Could not save lead" },
      { status: 500 }
    );
  }
}

export async function onRequestPatch({ request, env }) {
  try {
    const data = await request.json();

    const tenantId = data.tenantId || data.tenant_id;
    const allowedStatuses = ["New", "Contacted", "Booked", "Closed"];

    if (!data.id || !tenantId) {
      return Response.json(
        { error: "Lead ID and tenant ID are required" },
        { status: 400 }
      );
    }

    const updates = [];
    const values = [];

    if (data.status !== undefined) {
      if (!allowedStatuses.includes(data.status)) {
        return Response.json(
          { error: "Invalid lead status" },
          { status: 400 }
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
        return Response.json(
          { error: "Follow-up completion must be true, false, 1 or 0" },
          { status: 400 }
        );
      }

      updates.push("follow_up_completed = ?");
      values.push(completed);
    }

    if (updates.length === 0) {
      return Response.json(
        { error: "No valid updates were provided" },
        { status: 400 }
      );
    }

    values.push(data.id, tenantId);

    const result = await env.DB.prepare(
      `UPDATE leads
       SET ${updates.join(", ")}
       WHERE id = ? AND tenant_id = ?`
    ).bind(...values).run();

    return Response.json({
      success: true,
      changes: result.meta.changes
    });
  } catch (error) {
    return Response.json(
      { error: "Could not update lead" },
      { status: 500 }
    );
  }
}
