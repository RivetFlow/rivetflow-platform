
const RESEND_API = "https://api.resend.com/emails";
const REMINDER_EMAIL = "hello@rivetflowtechnologies.com";
const FROM_EMAIL = "RivetFlow <notifications@rivetflowtechnologies.com>";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendReminders(env));
  },

  async fetch() {
    return new Response("RivetFlow Reminder Engine is running.", {
      status: 200
    });
  }
};

async function sendReminders(env) {
  if (!env.DB || !env.RESEND_API_KEY) {
    throw new Error("Missing DB binding or RESEND_API_KEY secret.");
  }

  const result = await env.DB.prepare(`
    SELECT l.id, l.customer_name, l.service, l.follow_up_at,
           l.priority, l.next_action, t.business_name
    FROM leads l
    LEFT JOIN tenants t ON t.id = l.tenant_id
    LEFT JOIN lead_reminders r ON r.lead_id = l.id
    WHERE l.follow_up_at <= date('now')
      AND COALESCE(l.follow_up_completed, 0) = 0
      AND r.lead_id IS NULL
    ORDER BY l.follow_up_at ASC
  `).all();

  const leads = result.results || [];

  if (!leads.length) return;

  const rows = leads.map(lead => `
    <tr>
      <td>${escapeHtml(lead.customer_name)}</td>
      <td>${escapeHtml(lead.service || "General enquiry")}</td>
      <td>${escapeHtml(lead.priority || "Normal")}</td>
      <td>${escapeHtml(lead.business_name || "Your business")}</td>
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
      to: [REMINDER_EMAIL],
      subject: `RivetFlow: ${leads.length} lead(s) need follow-up`,
      html: `
        <h2>RivetFlow Follow-Up Reminder</h2>
        <p>You have ${leads.length} lead(s) requiring attention.</p>
        <table border="1" cellpadding="8" cellspacing="0">
          <tr>
            <th>Customer</th>
            <th>Service</th>
            <th>Priority</th>
            <th>Business</th>
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

  for (const lead of leads) {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO lead_reminders (lead_id, tenant_id, sent_at)
      SELECT id, tenant_id, datetime('now')
      FROM leads
      WHERE id = ?
    `).bind(lead.id).run();
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

