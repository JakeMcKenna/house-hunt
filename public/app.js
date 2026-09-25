import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const STATUSES = ["To review", "Want to view", "Called", "Viewing booked", "Viewed", "Offer made", "Not for us", "Sold / withdrawn"];
const PILL = { "To review": "p-review", "Want to view": "p-call", "Called": "p-plain", "Viewing booked": "p-good", "Viewed": "p-plain", "Offer made": "p-good", "Not for us": "p-bad", "Sold / withdrawn": "p-bad" };
const VSTAT = ["Confirmed", "Rescheduled", "Cancelled", "Done"];
const TZ = "Europe/London";

let props = [], views = [], filter = "Active", tab = "props", query = "", sort = "status", beds = "any";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const gbp = (n) => (n ? "£" + Number(n).toLocaleString("en-GB") : "POA");
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "p-" + Date.now();
const londonDate = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD
const londonTime = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);
const dayLabel = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(d);
const shortDay = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric" }).format(d);

function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2200); }

// London wall-clock date+time -> UTC ISO string (handles BST/GMT)
function londonToIso(date, time) {
  const guess = new Date(`${date}T${time}:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess).map((p) => [p.type, p.value]));
  const asLondon = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  return new Date(guess.getTime() - (asLondon - guess.getTime())).toISOString();
}

// ---------- auth: one shared login, the app only asks for the password ----------
const SHARED_EMAIL = "house-hunt@example.com";
async function start() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showSignIn();
  $("signin").hidden = true; $("app").hidden = false;
  await Promise.all([loadProps(), loadViews()]);
  subscribe();
  checkPending();
  loadFeedLink();
}
function showSignIn(msg) {
  $("app").hidden = true; $("signin").hidden = false;
  if (msg) $("signin-msg").textContent = msg;
  $("pw").focus();
}
$("signin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const { error } = await sb.auth.signInWithPassword({ email: SHARED_EMAIL, password: $("pw").value });
  if (error) { $("signin-msg").textContent = "That password didn't work. Try again."; $("pw").select(); return; }
  $("pw").value = ""; start();
});
$("btn-signout").onclick = async () => { await sb.auth.signOut(); location.reload(); };

// ---------- data ----------
async function loadProps() {
  const all = []; let from = 0;
  for (;;) {
    const { data, error } = await sb.from("properties").select("*").range(from, from + 999);
    if (error) { $("foot").textContent = "Couldn't load properties: " + error.message; return; }
    all.push(...data); if (data.length < 1000) break; from += 1000;
  }
  props = all; render();
}
async function loadViews() {
  const { data, error } = await sb.from("viewings").select("*").order("starts_at");
  if (error) { $("foot").textContent = "Couldn't load viewings: " + error.message; return; }
  views = data; render();
}
function subscribe() {
  let tp, tv;
  sb.channel("hh")
    .on("postgres_changes", { event: "*", schema: "public", table: "properties" }, () => { clearTimeout(tp); tp = setTimeout(loadProps, 300); })
    .on("postgres_changes", { event: "*", schema: "public", table: "viewings" }, () => { clearTimeout(tv); tv = setTimeout(loadViews, 300); })
    .subscribe((s) => { $("foot").textContent = s === "SUBSCRIBED" ? "Live. Changes save as you make them." : "Reconnecting…"; });
}
async function save(table, id, patch, msg) {
  const { error } = await sb.from(table).update(patch).eq("id", id);
  toast(error ? "Couldn't save: " + error.message : msg);
}

// ---------- rendering ----------
// ---------- routing: one page, tabs live in the URL hash so Back works in the installed app ----------
const ROUTES = { call: "#call", props: "#properties", views: "#viewings" };
const tabFromHash = () => Object.keys(ROUTES).find((k) => ROUTES[k] === location.hash);
function setTab(t) { tab = t; for (const k of Object.keys(ROUTES)) { $("p-" + k).hidden = k !== t; $("t-" + k).setAttribute("aria-selected", k === t); } try { localStorage.setItem("hh-tab", t); } catch {} }
function go(t) { if (location.hash !== ROUTES[t]) location.hash = ROUTES[t]; else setTab(t); }
window.addEventListener("hashchange", () => { const t = tabFromHash(); if (t) setTab(t); });
document.querySelectorAll(".tab").forEach((b) => (b.onclick = () => go(b.dataset.tab)));
document.querySelectorAll(".stat").forEach((b) => (b.onclick = () => { if (b.dataset.filter) filter = b.dataset.filter; go(b.dataset.go); render(); }));
$("q").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); render(); });
$("sort").addEventListener("change", (e) => { sort = e.target.value; render(); });
const BEDS = { any: () => true, "4-5": (b) => b === 4 || b === 5, "4": (b) => b === 4, "5": (b) => b === 5, "6+": (b) => b >= 6 };
try { const b = localStorage.getItem("hh-beds"); if (b && BEDS[b]) { beds = b; $("beds").value = b; } } catch {}
$("beds").addEventListener("change", (e) => { beds = e.target.value; try { localStorage.setItem("hh-beds", beds); } catch {} render(); });

const telHref = (n) => "tel:" + String(n).replace(/[^\d+]/g, "");
function propCard(p, forCall = false) {
  const st = p.status || "To review";
  const cls = st === "To review" ? "review" : st === "Want to view" ? "call" : "";
  const opts = STATUSES.map((s) => `<option ${s === st ? "selected" : ""}>${s}</option>`).join("");
  const link = p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener">View on Rightmove</a>` : "";
  const seen = p.first_seen ? ` · first seen ${new Date(p.first_seen + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "";
  return `<article class="card ${cls}" data-id="${esc(p.id)}">
    <div class="row"><span class="price">${gbp(p.price)}${p.price_note ? `<small>${esc(p.price_note)}</small>` : ""}</span>
      <span>${p.alert ? `<span class="pill ${p.alert === "Reduced" ? "p-call" : "p-plain"}">${esc(p.alert)}</span> ` : ""}<span class="pill ${PILL[st] || "p-plain"}">${esc(st)}</span></span></div>
    <div><div class="addr">${esc(p.address)}</div>
      <div class="meta">${[p.beds ? p.beds + " bed" : "", p.property_type, p.agent].filter(Boolean).map(esc).join(" · ")}${seen}</div></div>
    ${forCall && p.phone
      ? `<div class="phone"><a class="btn primary call" href="${esc(telHref(p.phone))}" data-call="${esc(p.id)}">Call ${esc(p.agent.split(",")[0] || "agent")} · ${esc(p.phone)}</a>${link}</div>`
      : p.phone || link ? `<div class="phone">${p.phone ? `<a class="tel" href="${esc(telHref(p.phone))}" data-call="${esc(p.id)}">${esc(p.phone)}</a><button class="btn" data-copy="${esc(p.phone)}" type="button">Copy</button>` : ""}${link}</div>` : ""}
    <div class="controls">
      <select aria-label="Status" id="st-${esc(p.id)}" data-f="status">${opts}</select>
      <textarea aria-label="Notes" id="nt-${esc(p.id)}" data-f="notes" placeholder="Notes (garden, parking, school catchment…)">${esc(p.notes)}</textarea>
    </div></article>`;
}
function viewCard(v) {
  const st = v.status || "Confirmed", d = new Date(v.starts_at);
  const pc = st === "Cancelled" ? "p-bad" : st === "Done" ? "p-plain" : st === "Rescheduled" ? "p-review" : "p-good";
  const opts = VSTAT.map((s) => `<option ${s === st ? "selected" : ""}>${s}</option>`).join("");
  const strike = st === "Cancelled" ? "strike" : "";
  return `<article class="card" data-vid="${esc(v.id)}"><div class="vt"><div class="time ${strike}">${londonTime(d)}</div><div style="display:flex;flex-direction:column;gap:6px">
    <div class="row"><span class="addr ${strike}">${esc(v.address)}</span><span>${v.booked_via === "app" && !v.email_confirmed_at && st !== "Cancelled" ? `<span class="pill p-review" title="Booked by phone. No confirmation email from the agent yet.">No email yet</span> ` : ""}<span class="pill ${pc}">${esc(st)}</span></span></div>
    <div class="meta">${[v.agent, v.contact, v.with_whom].filter(Boolean).map(esc).join(" · ")}</div>
    ${v.notes ? `<div class="meta">${esc(v.notes)}</div>` : ""}
    <div class="row" style="justify-content:flex-start"><select aria-label="Viewing status" id="vs-${esc(v.id)}" data-vf="status" style="max-width:170px">${opts}</select></div>
  </div></div></article>`;
}

function render() {
  const active = (p) => !["Not for us", "Sold / withdrawn"].includes(p.status);
  const review = props.filter((p) => p.status === "To review");
  const call = props.filter((p) => p.status === "Want to view");
  $("n-review").textContent = review.length; $("n-call").textContent = call.length;
  $("s-review").classList.toggle("hot", review.length > 0); $("s-call").classList.toggle("hot", call.length > 0);

  const cutoff = Date.now() - 3600e3;
  const upcoming = views.filter((v) => !["Cancelled", "Done"].includes(v.status) && new Date(v.starts_at).getTime() >= cutoff);
  const past = views.filter((v) => !upcoming.includes(v)).reverse();
  const nx = upcoming[0];
  $("n-next").textContent = nx ? `${shortDay(new Date(nx.starts_at))} ${londonTime(new Date(nx.starts_at))} · ${nx.address.split(",")[0]}` : "None booked";

  const pool = props.filter((p) => BEDS[beds](p.beds));
  const counts = { Active: pool.filter(active).length, All: pool.length };
  STATUSES.forEach((s) => (counts[s] = pool.filter((p) => p.status === s).length));
  $("chips").innerHTML = ["Active", ...STATUSES.filter((s) => counts[s]), "All"].map((s) => `<button class="chip" type="button" data-chip="${esc(s)}" aria-pressed="${s === filter}">${esc(s)} ${counts[s]}</button>`).join("");

  let shown = pool.filter((p) => (filter === "All" ? true : filter === "Active" ? active(p) : p.status === filter));
  if (query) shown = shown.filter((p) => [p.address, p.agent, p.property_type, p.notes].join(" ").toLowerCase().includes(query));
  const order = (s) => ({ "To review": 0, "Want to view": 1, "Viewing booked": 2, "Called": 3, "Viewed": 4, "Offer made": 5 })[s] ?? 9;
  const byNew = (a, b) => (b.first_seen || "").localeCompare(a.first_seen || "") || (b.created_at || "").localeCompare(a.created_at || "");
  const sorters = {
    status: (a, b) => order(a.status) - order(b.status) || byNew(a, b),
    newest: byNew,
    "price-asc": (a, b) => (a.price ?? 1e12) - (b.price ?? 1e12),
    "price-desc": (a, b) => (b.price ?? -1) - (a.price ?? -1),
  };
  shown.sort(sorters[sort]);

  // Keep focus/typing intact: skip re-render of a list while the user is editing inside it
  const editing = document.activeElement?.closest?.("#prop-list, #call-list, #view-list, #past-list");
  if (!editing || editing.id !== "prop-list") $("prop-list").innerHTML = shown.length ? shown.map(propCard).join("") : `<div class="empty">Nothing here.</div>`;
  if (!editing || editing.id !== "call-list") $("call-list").innerHTML = call.length ? call.map((p) => propCard(p, true)).join("") : `<div class="empty">No calls to make. Mark a house <b>Want to view</b> and it appears here.</div>`;

  const today = londonDate(new Date());
  let html = "", last = "";
  for (const v of upcoming) {
    const d = new Date(v.starts_at), key = londonDate(d);
    if (key !== last) { html += `<div class="day">${key === today ? "Today · " : ""}${dayLabel(d)}</div>`; last = key; }
    html += viewCard(v);
  }
  if (!editing || editing.id !== "view-list") $("view-list").innerHTML = html || `<div class="empty">No upcoming viewings.</div>`;
  if (!editing || editing.id !== "past-list") $("past-list").innerHTML = past.map(viewCard).join("") || `<div class="empty">None yet.</div>`;
  $("past-sum").textContent = `Past and cancelled (${past.length})`;
}

// ---------- calendar feed link ----------
async function loadFeedLink() {
  const { data, error } = await sb.from("app_settings").select("value").eq("key", "ical_token").maybeSingle();
  if (error || !data) { $("feed-url").value = "Couldn't load the calendar link."; return; }
  const url = `${SUPABASE_URL}/functions/v1/viewings-ics?token=${data.value}`;
  $("feed-url").value = url;
  $("feed-open").href = url.replace(/^https:/, "webcal:");
}
$("feed-copy").onclick = async () => {
  try { await navigator.clipboard.writeText($("feed-url").value); toast("Calendar link copied"); }
  catch { $("feed-url").select(); toast("Link selected. Copy it from the box."); }
};

// ---------- after a call: ask how it went ----------
const PENDING = "hh-pending-call";
const readPending = () => { try { return JSON.parse(localStorage.getItem(PENDING) || "null"); } catch { return null; } };
const writePending = (v) => { try { v ? localStorage.setItem(PENDING, JSON.stringify(v)) : localStorage.removeItem(PENDING); } catch {} };
let acProp = null;
function checkPending() {
  const pc = readPending();
  if (!pc || $("after-call").open || !props.length) return;
  if (Date.now() - pc.at > 12 * 3600e3) return writePending(null);   // stale
  if (Date.now() - pc.at < 2000) return;                              // tel: link hasn't handed over yet
  acProp = props.find((p) => p.id === pc.id);
  if (!acProp) return writePending(null);
  $("ac-form").reset(); $("ac-when").hidden = true;
  $("ac-sub").textContent = `${acProp.agent || "Agent"} · ${acProp.address}`;
  $("after-call").showModal();
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") setTimeout(checkPending, 300); });
window.addEventListener("focus", () => setTimeout(checkPending, 300));
$("ac-form").addEventListener("change", (e) => {
  if (e.target.name !== "ac-outcome") return;
  const booked = e.target.value === "booked";
  $("ac-when").hidden = !booked; $("ac-date").required = booked; $("ac-time").required = booked;
  if (booked && !$("ac-date").value) $("ac-date").value = londonDate(new Date());
});
$("ac-skip").onclick = () => { writePending(null); $("after-call").close(); };
$("ac-later").onclick = () => { const pc = readPending(); if (pc) writePending({ ...pc, at: Date.now() - 2500 }); $("after-call").close(); };
$("ac-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p = acProp; if (!p) return;
  const outcome = new FormData(e.target).get("ac-outcome");
  const extra = $("ac-notes").value.trim();
  const stamp = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const addNote = (line) => [p.notes, line + (extra ? " " + extra : "")].filter(Boolean).join("\n");
  $("ac-save").disabled = true;
  let error;
  if (outcome === "booked") {
    const d = $("ac-date").value, t = $("ac-time").value;
    const when = `${new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${t}`;
    ({ error } = await sb.from("viewings").insert({
      id: slug(`${d}-${t.replace(":", "")}-${p.id}`), property_id: p.id, starts_at: londonToIso(d, t),
      address: p.address, agent: p.agent, contact: p.phone, status: "Confirmed",
      booked_via: "app", email_confirmed_at: null, notes: extra ? `Booked by phone. ${extra}` : "Booked by phone.",
    }));
    if (!error) ({ error } = await sb.from("properties").update({ status: "Viewing booked", notes: addNote(`${stamp}: booked viewing by phone for ${when}.`) }).eq("id", p.id));
  } else if (outcome === "none") {
    ({ error } = await sb.from("properties").update({ status: "Called", notes: addNote(`${stamp}: called, no viewing booked.`) }).eq("id", p.id));
  } else {
    ({ error } = await sb.from("properties").update({ notes: addNote(`${stamp}: tried calling, couldn't get through.`) }).eq("id", p.id));
  }
  $("ac-save").disabled = false;
  if (error) { toast("Couldn't save: " + error.message); return; }
  writePending(null); $("after-call").close();
  toast(outcome === "booked" ? "Viewing saved. Claude will watch for the agent's email." : "Saved");
  if (outcome === "booked") go("views");
});

// ---------- events ----------
document.addEventListener("click", async (e) => {
  const tl = e.target.closest("[data-call]"); if (tl) { writePending({ id: tl.dataset.call, at: Date.now() }); return; }   // let the tel: link open the dialler
  const c = e.target.closest("[data-chip]"); if (c) { filter = c.dataset.chip; render(); return; }
  const cp = e.target.closest("[data-copy]");
  if (cp) {
    try { await navigator.clipboard.writeText(cp.dataset.copy); toast("Number copied"); }
    catch { const r = document.createRange(); r.selectNodeContents(cp.previousElementSibling); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Number selected"); }
  }
});
document.addEventListener("change", (e) => {
  const card = e.target.closest("[data-id]"), vcard = e.target.closest("[data-vid]");
  if (card && e.target.dataset.f) { const f = e.target.dataset.f; save("properties", card.dataset.id, { [f]: e.target.value }, f === "status" ? "Status saved" : "Notes saved"); }
  else if (vcard && e.target.dataset.vf) save("viewings", vcard.dataset.vid, { status: e.target.value }, "Viewing updated");
});
$("add-prop").addEventListener("submit", async (e) => {
  e.preventDefault();
  const a = $("ap-addr").value.trim(), link = $("ap-link").value.trim();
  const rid = link.match(/rightmove\.co\.uk\/properties\/(\d+)/)?.[1] ?? null;
  const { error } = await sb.from("properties").insert({
    id: slug(a) + (rid ? "-" + rid : ""), rightmove_id: rid, address: a,
    price: Number($("ap-price").value.replace(/\D/g, "")) || null, beds: Number($("ap-beds").value) || null,
    property_type: $("ap-type").value.trim(), agent: $("ap-agent").value.trim(), phone: $("ap-phone").value.trim(),
    link, alert: "Added by hand", source: "Added in app",
  });
  if (error) toast("Couldn't add it: " + error.message); else { e.target.reset(); toast("Property added"); }
});
$("add-view").addEventListener("submit", async (e) => {
  e.preventDefault();
  const a = $("av-addr").value.trim(), d = $("av-date").value, t = $("av-time").value;
  const { error } = await sb.from("viewings").insert({
    id: slug(`${d}-${t.replace(":", "")}-${a}`), starts_at: londonToIso(d, t), address: a,
    agent: $("av-agent").value.trim(), contact: $("av-contact").value.trim(),
  });
  if (error) toast("Couldn't add it: " + error.message); else { e.target.reset(); toast("Viewing added"); }
});

{
  let t = tabFromHash();
  if (!t) { try { t = localStorage.getItem("hh-tab"); } catch {} }
  t = ROUTES[t] ? t : "props";
  history.replaceState(null, "", ROUTES[t]); setTab(t);
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
start();
