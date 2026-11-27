
import { requireTenant } from "../../_lib/tenant.js";

function jsonResponse(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

async function checkSubscription(db, tenantId) {
  const subscription = await db.prepare(`
    SELECT status, current_period_end, grace_period_ends_at
    FROM tenant_subscriptions
    WHERE tenant_id = ?
    LIMIT 1
  `).bind(tenantId).first();

  if (!subscription) return false;

  const now = Date.now();

  if (subscription.status === "active") {
    const end = Date.parse(subscription.current_period_end || "");

    return Number.isFinite(end) && end > now;
  }

  if (subscription.status === "past_due") {
    const graceEnd = Date.parse(
      subscription.grace_period_ends_at || ""
    );

    return Number.isFinite(graceEnd) && graceEnd > now;
  }

  return false;
}

function cleanDnsValue(value) {
  return String(value || "")
    .replace(/"\s+"/g, "")
    .replace(/^"|"$/g, "");
}

async function verifyDnsRecord(domain, token) {
  const hostname = `_rivetflow-verification.${domain}`;

  const dnsUrl = new URL("https://cloudflare-dns.com/dns-query");
  dnsUrl.searchParams.set("name", hostname);
  dnsUrl.searchParams.set("type", "TXT");

  const response = await fetch(dnsUrl.toString(), {
    headers: {
      Accept: "application/dns-json",
    },
  });

  if (!response.ok) {
    throw new Error("DNS verification service unavailable.");
  }

  const result = await response.json();

  if (result.Status !== 0 || !Array.isArray(result.Answer)) {
    return false;
  }

  return result.Answer.some(record => {
    if (record.type !== 16) return false;

    const recordName = String(record.name || "")
      .toLowerCase()
      .replace(/\.$/, "");

    if (recordName !== hostname.toLowerCase()) {
      return false;
    }

    return cleanDnsValue(record.data) === token;
  });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return jsonResponse({
        success: false,
        error: "Database service is unavailable.",
      }, 500);
    }

    const access = await requireTenant(request, env);

    if (!access.ok) return access.response;

    if (access.role !== "owner") {
      return jsonResponse({
        success: false,
        error: "Only the business owner can verify website connections.",
      }, 403);
    }

    const hasSubscription = await checkSubscription(
      env.DB,
      access.tenantId
    );

    if (!hasSubscription) {
      return jsonResponse({
        success: false,
        error: "An active paid subscription is required.",
        code: "SUBSCRIPTION_REQUIRED",
      }, 403);
    }

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

    const websiteId =
      typeof body.websiteId === "string"
        ? body.websiteId.trim().slice(0, 100)
        : "";

    if (!websiteId) {
      return jsonResponse({
        success: false,
        error: "A website ID is required.",
      }, 400);
    }

    const connection = await env.DB.prepare(`
      SELECT id, domain, verification_status
      FROM website_connections
      WHERE id = ? AND tenant_id = ?
      LIMIT 1
    `).bind(
      websiteId,
      access.tenantId
    ).first();

    if (!connection) {
      return jsonResponse({
        success: false,
        error: "Website connection not found.",
      }, 404);
    }

    if (connection.verification_status === "verified") {
      return jsonResponse({
        success: true,
        verified: true,
        message: "This website has already been verified.",
      });
    }

    const verification = await env.DB.prepare(`
      SELECT id, token, expires_at
      FROM website_verification_tokens
      WHERE website_connection_id = ?
        AND tenant_id = ?
        AND verified_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `).bind(
      websiteId,
      access.tenantId
    ).first();

    if (!verification) {
      return jsonResponse({
        success: false,
        error: "No active verification request was found.",
      }, 404);
    }

    const expiry = Date.parse(verification.expires_at);

    if (!Number.isFinite(expiry) || expiry <= Date.now()) {
      return jsonResponse({
        success: false,
        error: "The verification token has expired. A new token is required.",
        code: "TOKEN_EXPIRED",
      }, 410);
    }

    const verified = await verifyDnsRecord(
      connection.domain,
      verification.token
    );

    if (!verified) {
      return jsonResponse({
        success: true,
        verified: false,
        message: "The DNS verification record was not found. Check the TXT record and try again.",
      });
    }

    // A unique marker prevents a second simultaneous attempt
    // from treating another request's token update as its own.
    const verificationStamp =
      `${new Date().toISOString()}-${crypto.randomUUID()}`;

    const results = await env.DB.batch([
      env.DB.prepare(`
        UPDATE website_verification_tokens
        SET verified_at = ?
        WHERE id = ?
          AND tenant_id = ?
          AND website_connection_id = ?
          AND verified_at IS NULL
          AND expires_at > ?
      `).bind(
        verificationStamp,
        verification.id,
        access.tenantId,
        websiteId,
        new Date().toISOString()
      ),

      env.DB.prepare(`
        UPDATE website_connections
        SET
          verification_status = 'verified',
          updated_at = ?
        WHERE id = ?
          AND tenant_id = ?
          AND verification_status != 'verified'
          AND EXISTS (
            SELECT 1
            FROM website_verification_tokens
            WHERE id = ?
              AND tenant_id = ?
              AND website_connection_id = ?
              AND verified_at = ?
          )
      `).bind(
        new Date().toISOString(),
        websiteId,
        access.tenantId,
        verification.id,
        access.tenantId,
        websiteId,
        verificationStamp
      ),
    ]);

    const tokenChanges = results?.[0]?.meta?.changes || 0;
    const websiteChanges = results?.[1]?.meta?.changes || 0;

    if (tokenChanges !== 1 || websiteChanges !== 1) {
      return jsonResponse({
        success: false,
        error: "Verification could not be completed. Please try again.",
        code: "VERIFICATION_UPDATE_FAILED",
      }, 409);
    }

    return jsonResponse({
      success: true,
      verified: true,
      message: "Website ownership successfully verified.",
    });

  } catch (error) {
    console.error("Website verification error:", error);

    return jsonResponse({
      success: false,
      error: "Could not verify website ownership. Please try again.",
    }, 500);
  }
}
