
export async function onRequestGet({ env }) {
  try {
    const result = await env.DB.prepare(
      "SELECT * FROM leads ORDER BY created_at DESC"
    ).all();

    return Response.json(result.results);
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

    if (!data.customer_name || !data.tenant_id) {
      return Response.json(
        { error: "Customer name and tenant ID are required" },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();

    await env.DB.prepare(
      `INSERT INTO leads
       (id, tenant_id, customer_name, email, phone, service, message, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      data.tenant_id,
      data.customer_name,
      data.email || null,
      data.phone || null,
      data.service || null,
      data.message || null,
      "new"
    ).run();

    return Response.json({ success: true, id }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: "Could not save lead" },
      { status: 500 }
    );
  }
}
