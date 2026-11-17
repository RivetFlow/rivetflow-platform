
export async function onRequestPost({ env }) {
  try {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tenants (id, business_name)
       VALUES (?, ?)`
    ).bind(
      "northstar-demo",
      "Northstar Renovations"
    ).run();

    return Response.json({
      success: true,
      message: "Northstar Renovations demo account created."
    });
  } catch (error) {
    return Response.json(
      { error: "Could not create demo account" },
      { status: 500 }
    );
  }
}
