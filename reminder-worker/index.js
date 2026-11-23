
const RESEND_API = "https://api.resend.com/emails";
const REMINDER_EMAIL = "hello@rivetflowtechnologies.com";
const FROM_EMAIL = "RivetFlow <notifications@rivetflowtechnologies.com>";

export default {
  async scheduled(event, env, ctx) {
    if (env.REMINDERS_ENABLED !== "true") return;
    ctx.waitUntil(sendReminders(env));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/check") {
      try {
        if (!env.DB) {
          return Response.json({ success: false, error: "Database binding missing." }, { status: 500 });
        }

        const result = await env.DB.prepare(`
          SELECT COUNT(*) AS due_count
          FROM leads l
          LEFT JOIN lead_reminders r ON r.lead_id = l.id
          WHERE l.follow_up_at <= date('now')
            AND COALESCE(l.follow_up_completed, 0) = 0
            AND r.lead_id IS NULL
        `).first();

        return Response.json({
          success: true,
          message: "Database check completed. No emails were sent.",
          due_leads: result?.due_count ?? 0,
          automatic_sending: env.REMINDERS_ENABLED === "true" ? "enabled" : "paused"
        });
      } catch (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 });
      }
    }

    if (url.pathname === "/send-test") {
      if (!env.TEST_EMAIL_TOKEN || url.searchParams.get("token") !== env.TEST_EMAIL_TOKEN) {
        return new Response("Unauthorized", { status: 401 });
      }

      if (!env.RESEND_API_KEY) {
        return Response.json({ success: false, error: "Resend API key missing." }, { status: 500 });
      }

      try {
        const response = await fetch(RESEND_API, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [REMINDER_EMAIL],
            subject: "RivetFlow — Test Email",
            html: `
              <h2>RivetFlow Email Test Successful</h2>
              <p>Your RivetFlow Reminder Engine is connected to Resend.</p>
              <p>This was a test only. No customer reminders were sent or changed.</p>
            `
          })
        });

        const result = await response.json();

        if (!response.ok) {
          return Response.json({
            success: false,
            error: result.message || "Resend could not send the test email."
          }, { status: 502 });
        }

        return Response.json({
          success: true,
          message: "Test email accepted by Resend.",
          recipient: REMINDER_EMAIL,
          email_id: result.id
        });
      } catch (error) {
        return Response.json({ success: false, error: error.message }, { status: 500 });
      }
    }

    return new Response("RivetFlow Reminder Engine is running. Automatic sending is paused.", {
      status: 200
    });
  }
};

async function sendReminders(env) {
  if (!env.DB || !env.RESEND_API_KEY) {
    throw new Error("Missing DB binding or RESEND_API_KEY secret.");
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
      t.notification_email
    FROM leads l
    INNER JOIN tenants t ON t.id = l.tenant_id
    LEFT JOIN lead_reminders r ON r.lead_id = l.id
    WHERE l.follow_up_at <= date('now')
      AND COALESCE(l.follow_up_completed, 0) = 0
      AND r.lead_id IS NULL
      AND t.notification_email IS NOT NULL
      AND TRIM(t.notification_email) != ''
    ORDER BY l.tenant_id, l.follow_up_at ASC
  `).all();

  const leads = result.results || [];
  if (!leads.length) return;

  const groups = new Map();

  for (const lead of leads) {
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

    const response = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [group.email],
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
      })
    });

    if (!response.ok) {
      throw new Error(`Resend email failed: ${await response.text()}`);
    }

    for (const lead of group.leads) {
      await env.DB.prepare(`
        INSERT OR IGNORE INTO lead_reminders (lead_id, tenant_id, sent_at)
        VALUES (?, ?, datetime('now'))
      `).bind(lead.id, lead.tenant_id).run();
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
