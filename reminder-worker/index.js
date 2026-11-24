
const RESEND_API = "https://api.resend.com/emails";
const FROM_EMAIL = "RivetFlow <notifications@rivetflowtechnologies.com>";
const STALE_MINUTES = 120;

export default {
  async scheduled(event, env, ctx) {
    if (env.REMINDERS_ENABLED !== "true") return;
    ctx.waitUntil(sendReminders(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/check") {
      try {
        const result = await env.DB.prepare(`
          SELECT COUNT(*) AS due_count
          FROM leads l
          LEFT JOIN lead_reminders r ON r.lead_id = l.id
          WHERE l.follow_up_at <= date('now')
            AND COALESCE(l.follow_up_completed, 0) = 0
            AND (
              r.lead_id IS NULL
              OR r.status = 'failed'
              OR (
                r.status = 'processing'
                AND r.sent_at <= datetime('now', '-${STALE_MINUTES} minutes')
              )
            )
        `).first();

        return Response.json({
          success: true,
          due_leads: result?.due_count ?? 0,
          automatic_sending:
            env.REMINDERS_ENABLED === "true" ? "enabled" : "paused"
        });
      } catch (error) {
        return Response.json(
          { success: false, error: error.message },
          { status: 500 }
        );
      }
    }

    if (
      url.pathname === "/send-test" ||
      url.pathname === "/send-business-test"
    ) {
      if (
        !env.TEST_EMAIL_TOKEN ||
        url.searchParams.get("token") !== env.TEST_EMAIL_TOKEN
      ) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (url.pathname === "/send-test") {
        if (!env.TEST_EMAIL_TO) {
          return Response.json({
            success: false,
            error: "TEST_EMAIL_TO secret is not configured."
          }, { status: 400 });
        }

        return sendTestEmail(env, env.TEST_EMAIL_TO);
      }

      const tenantId = url.searchParams.get("tenant_id");

      if (!tenantId || !tenantId.trim()) {
        return Response.json({
          success: false,
          error: "A tenant_id query parameter is required."
        }, { status: 400 });
      }

      return sendBusinessTest(env, tenantId.trim());
    }

    return new Response(
      "RivetFlow Reminder Engine is running. Automatic sending is paused.",
      { status: 200 }
    );
  }
};

async function sendBusinessTest(env, tenantId) {
  try {
    const result = await env.DB.prepare(`
      SELECT
        l.id,
        l.customer_name,
        l.service,
        l.follow_up_at,
        l.priority,
        l.next_action,
        t.business_name,
        t.notification_email
      FROM leads l
      INNER JOIN tenants t ON t.id = l.tenant_id
      LEFT JOIN lead_reminders r ON r.lead_id = l.id
      WHERE l.tenant_id = ?
        AND l.follow_up_at <= date('now')
        AND COALESCE(l.follow_up_completed, 0) = 0
        AND (
          r.lead_id IS NULL
          OR r.status = 'failed'
        )
        AND t.notification_email IS NOT NULL
        AND TRIM(t.notification_email) != ''
      ORDER BY l.follow_up_at ASC
    `).bind(tenantId).all();

    const leads = result.results || [];

    if (!leads.length) {
      return Response.json({
        success: false,
        message: "No eligible overdue leads found. No email was sent."
      });
    }

    const recipient = leads[0].notification_email;
    const business = leads[0].business_name || "Your business";

    const rows = leads.map(lead => `
      <tr>
        <td>${escapeHtml(lead.customer_name)}</td>
        <td>${escapeHtml(lead.service || "General enquiry")}</td>
        <td>${escapeHtml(lead.priority || "Normal")}</td>
        <td>${escapeHtml(lead.follow_up_at || "")}</td>
        <td>${escapeHtml(lead.next_action || "Follow up with customer")}</td>
      </tr>
    `).join("");

    const response = await sendEmail(env, {
      to: recipient,
      subject: `RivetFlow: ${leads.length} lead(s) need follow-up`,
      html: `
        <h2>RivetFlow Follow-Up Reminder</h2>
        <p>${escapeHtml(business)} has ${leads.length} lead(s) requiring attention.</p>
        <table border="1" cellpadding="8" cellspacing="0">
          <tr>
            <th>Customer</th>
            <th>Service</th>
            <th>Priority</th>
            <th>Follow-up date</th>
            <th>Next action</th>
          </tr>
          ${rows}
        </table>
        <p>This is a manual test. No reminder records were changed.</p>
      `
    });

    return Response.json({
      success: true,
      message: "Business-specific test reminder accepted by Resend.",
      business,
      recipient,
      leads_included: leads.length,
      email_id: response.id,
      reminder_records_changed: false
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

async function sendTestEmail(env, recipient) {
  try {
    const data = await sendEmail(env, {
      to: recipient,
      subject: "RivetFlow — Test Email",
      html: `
        <h2>RivetFlow Email Test Successful</h2>
        <p>Your email connection is working.</p>
      `
    });

    return Response.json({
      success: true,
      message: "Test email accepted by Resend.",
      recipient,
      email_id: data.id
    });
  } catch (error) {
    return Response.json(
      { success: false, error: error.message },
      { status: 502 }
    );
  }
}

async function sendEmail(env, email) {
  if (!env.RESEND_API_KEY) {
    throw new Error("Resend API key missing.");
  }

  const response = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [email.to],
      subject: email.subject,
      html: email.html
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Resend failed to send the email.");
  }

  return data;
}

async function claimLead(env, lead) {
  const inserted = await env.DB.prepare(`
    INSERT OR IGNORE INTO lead_reminders
      (lead_id, tenant_id, sent_at, status, attempt_count, last_error)
    VALUES (?, ?, datetime('now'), 'processing', 1, NULL)
  `).bind(lead.id, lead.tenant_id).run();

  if ((inserted.meta?.changes || 0) === 1) {
    return true;
  }

  const updated = await env.DB.prepare(`
    UPDATE lead_reminders
    SET
      status = 'processing',
      sent_at = datetime('now'),
      attempt_count = attempt_count + 1,
      last_error = NULL
    WHERE lead_id = ?
      AND (
        status = 'failed'
        OR (
          status = 'processing'
          AND sent_at <= datetime('now', '-${STALE_MINUTES} minutes')
        )
      )
  `).bind(lead.id).run();

  return (updated.meta?.changes || 0) === 1;
}

async function sendReminders(env) {
  if (!env.DB || !env.RESEND_API_KEY) {
    throw new Error("Missing database binding or Resend API key.");
  }

  const result = await env.DB.prepare(`
    SELECT
      l.id,
      l.tenant_id,
      l.customer_name,
      l.service,
      l.follow_up_at,
      l.priority,
      l.next_action,
      t.business_name,
      t.notification_email,
      r.status AS reminder_status,
      r.sent_at AS reminder_time
    FROM leads l
    INNER JOIN tenants t ON t.id = l.tenant_id
    LEFT JOIN lead_reminders r ON r.lead_id = l.id
    WHERE l.follow_up_at <= date('now')
      AND COALESCE(l.follow_up_completed, 0) = 0
      AND (
        r.lead_id IS NULL
        OR r.status = 'failed'
        OR (
          r.status = 'processing'
          AND r.sent_at <= datetime('now', '-${STALE_MINUTES} minutes')
        )
      )
      AND t.notification_email IS NOT NULL
      AND TRIM(t.notification_email) != ''
    ORDER BY l.tenant_id, l.follow_up_at ASC
  `).all();

  const groups = new Map();

  for (const lead of result.results || []) {
    const claimed = await claimLead(env, lead);
    if (!claimed) continue;

    if (!groups.has(lead.tenant_id)) {
      groups.set(lead.tenant_id, {
        email: lead.notification_email,
        business: lead.business_name || "Your business",
        leads: []
      });
    }

    groups.get(lead.tenant_id).leads.push(lead);
  }

  for (const group of groups.values()) {
    const rows = group.leads.map(lead => `
      <tr>
        <td>${escapeHtml(lead.customer_name)}</td>
        <td>${escapeHtml(lead.service || "General enquiry")}</td>
        <td>${escapeHtml(lead.priority || "Normal")}</td>
        <td>${escapeHtml(lead.follow_up_at || "")}</td>
      </tr>
    `).join("");

    try {
      await sendEmail(env, {
        to: group.email,
        subject: `RivetFlow: ${group.leads.length} lead(s) need follow-up`,
        html: `
          <h2>RivetFlow Follow-Up Reminder</h2>
          <p>${escapeHtml(group.business)} has ${group.leads.length} lead(s) requiring attention.</p>
          <table border="1" cellpadding="8" cellspacing="0">
            <tr>
              <th>Customer</th>
              <th>Service</th>
              <th>Priority</th>
              <th>Follow-up date</th>
            </tr>
            ${rows}
          </table>
          <p>Open your RivetFlow dashboard to manage these leads.</p>
        `
      });

      for (const lead of group.leads) {
        await env.DB.prepare(`
          UPDATE lead_reminders
          SET status = 'sent',
              sent_at = datetime('now'),
              last_error = NULL
          WHERE lead_id = ?
            AND status = 'processing'
        `).bind(lead.id).run();
      }
    } catch (error) {
      const message = String(error.message || error).slice(0, 1000);

      for (const lead of group.leads) {
        await env.DB.prepare(`
          UPDATE lead_reminders
          SET status = 'failed',
              last_error = ?
          WHERE lead_id = ?
            AND status = 'processing'
        `).bind(message, lead.id).run();
      }
    }
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}
