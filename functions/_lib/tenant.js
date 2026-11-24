import { createAuth } from "./auth.js";

function errorResponse(message, status) {
  return new Response(
    JSON.stringify({
      success: false,
      error: message
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}

export async function requireTenant(request, env) {
  try {
    // Check whether the request has a valid login session.
    const auth = createAuth(env);

    const session = await auth.api.getSession({
      headers: request.headers
    });

    if (!session || !session.user || !session.user.id) {
      return {
        ok: false,
        response: errorResponse("Authentication required.", 401)
      };
    }

    // Find every business this user is authorized to access.
    const result = await env.DB.prepare(
      `SELECT tenant_id, role
       FROM tenant_members
       WHERE user_id = ?
       ORDER BY created_at ASC`
    )
      .bind(session.user.id)
      .all();

    const memberships = result.results || [];

    if (memberships.length === 0) {
      return {
        ok: false,
        response: errorResponse("No business access is assigned to this account.", 403)
      };
    }

    // Require an explicit business selection if the user has multiple.
    if (memberships.length > 1) {
      return {
        ok: false,
        response: errorResponse("Business selection is required.", 409)
      };
    }

    return {
      ok: true,
      user: session.user,
      tenantId: memberships[0].tenant_id,
      role: memberships[0].role
    };

  } catch (error) {
    return {
      ok: false,
      response: errorResponse("Could not verify business access.", 500)
    };
  }
}
