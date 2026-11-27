
import { requireTenant } from "../_lib/tenant.js";

function jsonResponse(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function cleanText(value, maxLength = 2000) {
  if (typeof value !== "string") return null;

  const cleaned = value.trim().slice(0, maxLength);
  return cleaned || null;
}

function normalizeWebsite(value) {
  const input = cleanText(value, 2048);

  if (!input) {
    throw new Error("A website address is required.");
  }

  let url;

  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
        ? input
        : `https://${input}`
    );
  } catch {
    throw new Error("Enter a valid website address.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS websites are supported.");
  }

  if (url.username || url.password) {
    throw new Error("Website addresses cannot contain login credentials.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");

  if (
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.includes(":")
  ) {
    throw new Error("Enter a valid public website domain.");
  }

  url.hash = "";

  return {
    websiteUrl: url.toString(),
    domain: hostname.replace(/^www\./, ""),
  };
}

function createVerificationToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  const randomValue = Array.from(bytes)
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

  return `rivetflow-verify-${randomValue}`;
}

async function checkSubscription(db, tenantId) {
  const subscription = await db.prepare(`
    SELECT
      status,
      current_period_end,
      grace_period_ends_at
    FROM tenant_subscriptions
    WHERE tenant_id = ?
    LIMIT 1
  `).bind(tenantId).first();

  if (!subscription) return false;

  const now = Date.now();

  if (subscription.status === "active") {
    const periodEnd = Date.parse(
      subscription.current_period_end || ""
    );

    return Number.isFinite(periodEnd) && periodEnd > now;
  }

  if (subscription.status === "past_due") {
    const graceEnd = Date.parse(
      subscription.grace_period_ends_at || ""
    );

    return Number.isFinite(graceEnd) && graceEnd > now;
  }

  return false;
}

async function getAuthorizedTenant(request, env) {
  if (!env.DB) {
    return {
      ok: false,
      response: jsonResponse({
        success: false,
        error: "Database service is unavailable.",
      }, 500),
    };
  }

  const access = await requireTenant(request, env);

  if (!access.ok) {
    return {
      ok: false,
      response: access.response,
    };
  }

  if (access.role !== "owner") {
    return {
      ok: false,
      response: jsonResponse({
        success: false,
        error: "Only the business owner can manage website connections.",
      }, 403),
    };
  }

  const hasAccess = await checkSubscription(
    env.DB,
    access.tenantId
  );

  if (!hasAccess) {
    return {
      ok: false,
      response: jsonResponse({
        success: false,
        error: "An active paid subscription is required to manage website connections.",
        code: "SUBSCRIPTION_REQUIRED",
      }, 403),
    };
  }

  return {
    ok: true,
    tenantId: access.tenantId,
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const access = await getAuthorizedTenant(request, env);

    if (!access.ok) return access.response;

    const result = await env.DB.prepare(`
      SELECT
        id,
        website_url,
        domain,
        platform,
        verification_status,
        installation_status,
        verification_method,
        last_checked_at,
        created_at,
        updated_at
      FROM website_connections
      WHERE tenant_id = ?
      ORDER BY created_at DESC
    `).bind(access.tenantId).all();

    return jsonResponse({
      success: true,
      websites: result.results || [],
    });

  } catch (error) {
    console.error("Website connections GET error:", error);

    return jsonResponse({
      success: false,
      error: "Could not retrieve website connections.",
    }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const access = await getAuthorizedTenant(request, env);

    if (!access.ok) return access.response;

    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse({
        success: false,
        error: "Invalid request data.",
      }, 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonResponse({
        success: false,
        error: "Invalid request data.",
      }, 400);
    }

    let website;

    try {
      website = normalizeWebsite(body.website_url);
    } catch (error) {
      return jsonResponse({
        success: false,
        error: error.message,
      }, 400);
    }

    const existing = await env.DB.prepare(`
      SELECT id
      FROM website_connections
      WHERE tenant_id = ? AND domain = ?
      LIMIT 1
    `).bind(
      access.tenantId,
      website.domain
    ).first();

    if (existing) {
      return jsonResponse({
        success: false,
        error: "This domain has already been added to your account.",
      }, 409);
    }

    const websiteId = crypto.randomUUID();
    const verificationId = crypto.randomUUID();
    const token = createVerificationToken();

    const expiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000
    ).toISOString();

    const websiteInsert = env.DB.prepare(`
      INSERT INTO website_connections (
        id,
        tenant_id,
        website_url,
        domain,
        platform,
        verification_status,
        installation_status,
        verification_method
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      websiteId,
      access.tenantId,
      website.websiteUrl,
      website.domain,
      "unknown",
      "pending",
      "not_installed",
      "dns_txt"
    );

    const tokenInsert = env.DB.prepare(`
      INSERT INTO website_verification_tokens (
        id,
        tenant_id,
        website_connection_id,
        token,
        expires_at
      )
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      verificationId,
      access.tenantId,
      websiteId,
      token,
      expiresAt
    );

    await env.DB.batch([
      websiteInsert,
      tokenInsert,
    ]);

    return jsonResponse({
      success: true,
      website: {
        id: websiteId,
        website_url: website.websiteUrl,
        domain: website.domain,
        platform: "unknown",
        verification_status: "pending",
        installation_status: "not_installed",
      },
      verification: {
        method: "dns_txt",
        record_type: "TXT",
        host: "_rivetflow-verification",
        value: token,
        expires_at: expiresAt,
        instructions: "Add this TXT record to your domain DNS settings. Ownership is not confirmed until the record is checked by the verification service.",
      },
      message: "Website added. Ownership verification is still required.",
    }, 201);

  } catch (error) {
    console.error("Website connections POST error:", error);

    return jsonResponse({
      success: false,
      error: "Could not add the website connection.",
    }, 500);
  }
}
