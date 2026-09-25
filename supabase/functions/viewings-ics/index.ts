// Public iCalendar feed of house viewings, for FamilyWall (or any calendar app).
// GET /functions/v1/viewings-ics?token=<app_settings.ical_token>
// No sign-in: the long random token in the URL is the only protection.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function rest(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

// RFC 5545 text escaping and 75-octet line folding
const esc = (s: unknown) =>
  String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
function fold(line: string) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "", len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; len = 0; }
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const gbp = (n: number | null) => (n ? "£" + n.toLocaleString("en-GB") : "");
const ukDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

Deno.serve(async (req) => {
  try {
    const token = new URL(req.url).searchParams.get("token") ?? "";
    const [setting] = await rest("app_settings?key=eq.ical_token&select=value");
    if (!setting || token.length < 32 || token !== setting.value) {
      return new Response("Not found", { status: 404 });
    }

    const rows = await rest(
      "viewings?select=id,starts_at,address,agent,contact,with_whom,status,notes,booked_via,email_confirmed_at,updated_at," +
        "properties(price,price_note,beds,property_type,link)&status=neq.Cancelled&order=starts_at.asc",
    );

    const now = utc(new Date());
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//McKenna House Hunt//Viewings//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:House viewings",
      "X-WR-TIMEZONE:Europe/London",
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
      "X-PUBLISHED-TTL:PT1H",
    ];

    for (const v of rows) {
      const start = new Date(v.starts_at);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const confirmed = v.booked_via !== "app" || !!v.email_confirmed_at;
      const p = v.properties ?? {};
      const street = String(v.address).split(",")[0];
      const summary = confirmed ? `Viewing: ${street}` : `Viewing (no confirmation email): ${street}`;
      const desc = [
        confirmed
          ? `Confirmation email: received${v.email_confirmed_at ? " " + ukDate(v.email_confirmed_at) : ""}`
          : "Confirmation email: NOT received yet (booked by phone). Chase the agent.",
        `Address: ${v.address}`,
        [p.beds ? `${p.beds} bed` : "", p.property_type, [gbp(p.price), p.price_note].filter(Boolean).join(" ")].filter(Boolean).join(", "),
        v.agent ? `Agent: ${v.agent}${v.contact ? " (" + v.contact + ")" : ""}` : "",
        v.with_whom ? `With: ${v.with_whom}` : "",
        v.status === "Rescheduled" ? "Rescheduled by the agent" : "",
        v.notes ? `Notes: ${v.notes}` : "",
        p.link ? `Listing: ${p.link}` : "",
      ].filter(Boolean).join("\n");

      lines.push(
        "BEGIN:VEVENT",
        `UID:${v.id}@house-hunt`,
        `DTSTAMP:${now}`,
        `LAST-MODIFIED:${utc(new Date(v.updated_at))}`,
        `DTSTART:${utc(start)}`,
        `DTEND:${utc(end)}`,
        `SUMMARY:${esc(summary)}`,
        `LOCATION:${esc(v.address)}`,
        `DESCRIPTION:${esc(desc)}`,
        `STATUS:${confirmed ? "CONFIRMED" : "TENTATIVE"}`,
        ...(p.link ? [`URL:${p.link}`] : []),
        "TRANSP:OPAQUE",
        "END:VEVENT",
      );
    }
    lines.push("END:VCALENDAR");

    return new Response(lines.map(fold).join("\r\n") + "\r\n", {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="house-viewings.ics"',
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    console.error(e);
    return new Response("Calendar feed error", { status: 500 });
  }
});
