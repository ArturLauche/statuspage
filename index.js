const MAX_DAYS = 30;
const REFRESH_MS = 60_000;

const STATUS = {
  success: { label: "Operational", desc: "No downtime recorded on this day." },
  partial: {
    label: "Partial Outage",
    desc: "Partial outages recorded on this day.",
  },
  failure: { label: "Major Outage", desc: "Major outages recorded on this day." },
  nodata: { label: "No Data", desc: "No health check was performed on this day." },
};

const OVERALL = {
  operational: { title: "All Systems Operational", icon: iconCheck() },
  degraded: { title: "Partial System Outage", icon: iconAlert() },
  major: { title: "Major System Outage", icon: iconAlert() },
  nodata: { title: "Awaiting Health Data", icon: iconClock() },
};

// Acronyms that should stay upper-cased when prettifying service keys.
const ACRONYMS = new Set([
  "ai",
  "api",
  "cdn",
  "ip",
  "nas",
  "ui",
  "vpn",
  "vps",
]);

const $ = (sel) => document.querySelector(sel);

let lastUpdatedTs = 0;

/* ----------------------------------------------------------------- data -- */

async function loadConfig() {
  const response = await fetch("urls.cfg", { cache: "no-store" });
  const text = await response.text();
  // A Map de-duplicates repeated keys while preserving first-seen order; a
  // later line for the same key updates its URL (treated as a correction).
  const services = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const url = line.slice(eq + 1).trim();
    if (!key || !url) continue;
    services.set(key, url);
  }
  return [...services].map(([key, url]) => ({ key, url }));
}

async function loadService(key) {
  try {
    const response = await fetch(`logs/${key}_report.log`, {
      cache: "no-store",
    });
    return response.ok ? parseLog(await response.text()) : parseLog("");
  } catch {
    return parseLog("");
  }
}

function parseLog(text) {
  const byDate = {};
  let sum = 0;
  let count = 0;
  let latest = 0;
  let current = null; // result (1/0) of the single most recent check

  for (const row of text.split("\n")) {
    if (!row.trim()) continue;
    const [dateTimeStr, resultStr] = row.split(",", 2);
    if (!dateTimeStr || resultStr === undefined) continue;

    const dateTime = new Date(
      Date.parse(dateTimeStr.replace(/-/g, "/") + " GMT")
    );
    if (isNaN(dateTime)) continue;

    const result = resultStr.trim() === "success" ? 1 : 0;
    if (dateTime.getTime() >= latest) {
      latest = dateTime.getTime();
      current = result;
    }

    const dateStr = dateTime.toDateString();
    (byDate[dateStr] ||= []).push(result);
    sum += result;
    count++;
  }

  // Map each day to a relative-day index (0 = today) with its uptime average.
  const days = {};
  const now = Date.now();
  for (const [dateStr, results] of Object.entries(byDate)) {
    const rel = Math.floor(
      Math.abs((now - new Date(dateStr).getTime()) / 86_400_000)
    );
    days[rel] = results.reduce((a, v) => a + v, 0) / results.length;
  }

  return {
    days,
    upTime: count ? ((sum / count) * 100).toFixed(2) + "%" : "—",
    latest,
    current,
  };
}

function getColor(value) {
  if (value == null) return "nodata";
  if (value === 1) return "success";
  if (value < 0.3) return "failure";
  return "partial";
}

/* ------------------------------------------------------------ rendering -- */

let cloneId = 0;
function templatize(templateId, parameters) {
  const clone = document.getElementById(templateId).cloneNode(true);
  clone.id = "clone_" + cloneId++;
  if (parameters) applyTemplateSubstitutions(clone, parameters);
  return clone;
}

function applyTemplateSubstitutions(node, parameters) {
  for (const attr of node.getAttributeNames()) {
    node.setAttribute(attr, substitute(node.getAttribute(attr), parameters));
  }
  if (node.childElementCount === 0) {
    node.innerText = substitute(node.innerText, parameters);
  } else {
    Array.from(node.children).forEach((child) =>
      applyTemplateSubstitutions(child, parameters)
    );
  }
}

function substitute(text, parameters) {
  for (const [key, val] of Object.entries(parameters)) {
    text = text.replaceAll("$" + key, val);
  }
  return text;
}

function humanize(key) {
  return key
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) =>
      ACRONYMS.has(word.toLowerCase())
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
}

function formatUrl(url) {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function buildServiceCard(key, url, data) {
  // Headline status reflects the latest check; the bars show daily history.
  const color = getColor(data.current);
  const card = templatize("statusContainerTemplate", {
    title: humanize(key),
    url,
    displayUrl: formatUrl(url),
    color,
    status: STATUS[color].label,
    upTime: data.upTime,
  });
  card.dataset.key = key;
  card.dataset.name = (humanize(key) + " " + formatUrl(url)).toLowerCase();

  const stream = card.querySelector(".streamBars");
  for (let rel = MAX_DAYS - 1; rel >= 0; rel--) {
    stream.appendChild(buildBar(rel, data.days[rel]));
  }
  return card;
}

function buildBar(relDay, value) {
  const color = getColor(value);
  const date = new Date();
  date.setDate(date.getDate() - relDay);

  const bar = templatize("statusSquareTemplate", { color });
  bar.setAttribute("aria-label", `${date.toDateString()}: ${STATUS[color].label}`);
  bar.addEventListener("mouseenter", () => showTooltip(bar, date, color));
  bar.addEventListener("mouseleave", hideTooltip);
  return bar;
}

function buildSkeleton() {
  const card = document.createElement("div");
  card.className = "card skeleton";
  card.innerHTML =
    '<div class="skelTop">' +
    '<span class="skelLine dot"></span>' +
    '<span class="skelLine title"></span>' +
    '<span class="skelLine pill"></span>' +
    "</div>" +
    '<div class="skelStream"></div>';
  return card;
}

/* ------------------------------------------------------- overall status -- */

function updateOverall(colors) {
  const total = colors.length;
  const counts = { success: 0, partial: 0, failure: 0, nodata: 0 };
  colors.forEach((c) => counts[c]++);

  const withData = total - counts.nodata;
  let state;
  if (total === 0 || withData === 0) {
    state = "nodata";
  } else if (counts.failure === 0 && counts.partial === 0) {
    state = "operational";
  } else if (counts.failure >= Math.ceil(withData / 2)) {
    state = "major";
  } else {
    state = "degraded";
  }

  const banner = $("#overallStatus");
  banner.className = "overall overall--" + state;
  $("#overallIcon").innerHTML = OVERALL[state].icon;

  // Don't claim "All Systems Operational" while some services have no data —
  // drop the absolute wording and surface the missing data in the subtitle.
  let title = OVERALL[state].title;
  if (state === "operational" && counts.nodata > 0) title = "Systems Operational";
  $("#overallTitle").innerText = title;

  $("#overallSubtitle").innerText = buildSubtitle(total, counts);
}

function buildSubtitle(total, counts) {
  if (total === 0) return "No services configured";
  const parts = [`${counts.success} of ${total} operational`];
  if (counts.partial) parts.push(`${counts.partial} degraded`);
  if (counts.failure) parts.push(`${counts.failure} down`);
  if (counts.nodata) parts.push(`${counts.nodata} awaiting data`);
  return parts.join(" · ");
}

function updateLastUpdated() {
  const el = $("#lastUpdated");
  if (!lastUpdatedTs) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const date = new Date(lastUpdatedTs);
  el.title = date.toLocaleString();
  $("#lastUpdatedText").innerText = "Updated " + relativeTime(lastUpdatedTs);
}

function relativeTime(ts) {
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/* -------------------------------------------------------------- tooltip -- */

let tooltipTimeout = null;
function showTooltip(element, date, color) {
  clearTimeout(tooltipTimeout);
  const tip = $("#tooltip");

  $("#tooltipDateTime").innerText = date.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  $("#tooltipDescription").innerText = STATUS[color].desc;
  const status = $("#tooltipStatus");
  status.innerText = STATUS[color].label;
  status.className = "tooltipStatus " + color;

  tip.classList.add("isVisible");

  const rect = element.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const pad = 8;
  const gap = 10;

  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - tipRect.width - pad));

  let top = rect.top - tipRect.height - gap;
  let arrow = "bottom";
  if (top < pad) {
    top = rect.bottom + gap;
    arrow = "top";
  }

  tip.dataset.arrow = arrow;
  tip.style.setProperty(
    "--arrow-left",
    rect.left + rect.width / 2 - left + "px"
  );
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}

function hideTooltip() {
  tooltipTimeout = setTimeout(() => {
    $("#tooltip").classList.remove("isVisible");
  }, 200);
}

/* ---------------------------------------------------------------- theme -- */

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("theme", theme);
  } catch {
    /* ignore */
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#000000" : "#ffffff");
}

/* --------------------------------------------------------------- filter -- */

function applyFilter() {
  const query = $("#serviceFilter").value.trim().toLowerCase();
  const cards = document.querySelectorAll("#reports .card");
  let visible = 0;
  cards.forEach((card) => {
    const match = !query || (card.dataset.name || "").includes(query);
    card.style.display = match ? "" : "none";
    if (match) visible++;
  });
  $("#emptyState").hidden = visible !== 0 || cards.length === 0;
}

/* ----------------------------------------------------------------- main -- */

async function render() {
  const reports = $("#reports");

  // Show skeletons on the very first paint only.
  if (!reports.childElementCount) {
    for (let i = 0; i < 6; i++) reports.appendChild(buildSkeleton());
  }

  let services;
  try {
    services = await loadConfig();
  } catch {
    reports.innerHTML = "";
    reports.removeAttribute("aria-busy");
    updateOverall([]);
    $("#overallTitle").innerText = "Status Unavailable";
    $("#overallSubtitle").innerText = "Could not load the service configuration.";
    return;
  }

  const results = await Promise.all(services.map((s) => loadService(s.key)));

  const fragment = document.createDocumentFragment();
  const colors = [];
  lastUpdatedTs = 0;
  services.forEach((service, i) => {
    const data = results[i];
    colors.push(getColor(data.current));
    lastUpdatedTs = Math.max(lastUpdatedTs, data.latest);
    fragment.appendChild(buildServiceCard(service.key, service.url, data));
  });

  reports.innerHTML = "";
  reports.appendChild(fragment);
  reports.removeAttribute("aria-busy");

  // Stagger the entrance animation.
  reports.querySelectorAll(".card").forEach((card, i) => {
    card.style.animationDelay = Math.min(i * 45, 400) + "ms";
    card.classList.add("reveal");
  });

  updateOverall(colors);
  updateLastUpdated();
  applyFilter();
}

function init() {
  $("#themeToggle").addEventListener("click", () => {
    const next =
      document.documentElement.getAttribute("data-theme") === "dark"
        ? "light"
        : "dark";
    setTheme(next);
  });

  $("#serviceFilter").addEventListener("input", applyFilter);

  render();

  // Refresh data and relative timestamps periodically.
  setInterval(render, REFRESH_MS);
  setInterval(updateLastUpdated, 30_000);
}

document.addEventListener("DOMContentLoaded", init);

/* ------------------------------------------------------------- SVG icons -- */

function iconCheck() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
}
function iconAlert() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>';
}
function iconClock() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
}
