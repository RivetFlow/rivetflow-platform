
export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);

    // Accept both dashboard and backend naming formats.
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
      "SELECT * FROM leads WHERE tenant_id = ? ORDER BY created_at DESC"
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

    if (!data.customer_name || !tenantId || !data.service) {
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

    await env.DB.prepare(
      `INSERT INTO leads
       (id, tenant_id, customer_name, email, phone, service, message, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      tenantId,
      data.customer_name,
      data.email || null,
      data.phone || null,
      data.service,
      data.message || null,
      "New"
    ).run();

    return Response.json(
      { success: true, id },
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

    if (
      !data.id ||
      !tenantId ||
      !allowedStatuses.includes(data.status)
    ) {
      return Response.json(
        { error: "Valid lead ID, tenant ID and status are required" },
        { status: 400 }
      );
    }

    const result = await env.DB.prepare(
      "UPDATE leads SET status = ? WHERE id = ? AND tenant_id = ?"
    ).bind(
      data.status,
      data.id,
      tenantId
    ).run();

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
