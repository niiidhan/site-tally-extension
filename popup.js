const STORAGE_KEY = "visits";
let currentRange = "today";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  // Treat Monday as the first day of the week.
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d.getTime();
}

function rangeStart(range) {
  if (range === "today") return startOfToday();
  if (range === "week") return startOfWeek();
  return 0; // all time
}

function faviconUrl(host) {
  return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
}

async function render() {
  const { [STORAGE_KEY]: visits = [] } = await chrome.storage.local.get(STORAGE_KEY);
  const start = rangeStart(currentRange);

  const counts = {};
  let total = 0;
  for (const v of visits) {
    if (v.ts < start) continue;
    counts[v.host] = (counts[v.host] || 0) + 1;
    total++;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const list = document.getElementById("list");
  const empty = document.getElementById("empty");
  list.innerHTML = "";

  if (sorted.length === 0) {
    empty.hidden = false;
    renderStats(0, 0, null);
    updateArrow();
    return;
  }

  empty.hidden = true;
  renderStats(total, sorted.length, sorted[0]); // sorted[0] = [host, count] of top site

  for (const [host, count] of sorted) {
    const li = document.createElement("li");

    const img = document.createElement("img");
    img.src = faviconUrl(host);
    img.alt = "";

    const name = document.createElement("span");
    name.className = "host";
    name.textContent = host;
    name.title = host;

    const badge = document.createElement("span");
    badge.className = "count";
    badge.textContent = count;

    li.append(img, name, badge);
    li.addEventListener("click", () => openDetail(host));
    list.appendChild(li);
  }

  // Wait for layout before measuring scroll height.
  requestAnimationFrame(() => {
    updateArrow();
    syncHeight();
  });
}

// Build the top stats bar: Total Visits · Sites · Top Site (for the active range).
function renderStats(total, siteCount, top) {
  const stats = document.getElementById("stats");
  if (siteCount === 0) {
    stats.hidden = true;
    stats.innerHTML = "";
    return;
  }
  stats.hidden = false;
  stats.innerHTML = "";

  // A numeric stat (Total Visits / Sites).
  function numStat(value, label) {
    const el = document.createElement("div");
    el.className = "stat";
    const v = document.createElement("div");
    v.className = "stat-val";
    v.textContent = value;
    const l = document.createElement("div");
    l.className = "stat-label";
    l.textContent = label;
    el.append(v, l);
    return el;
  }

  // The Top Site stat: favicon only.
  function topStat([host, count]) {
    const el = document.createElement("div");
    el.className = "stat stat-top";
    const v = document.createElement("div");
    v.className = "stat-val";
    const img = document.createElement("img");
    img.className = "stat-fav";
    img.src = faviconUrl(host);
    img.alt = host;
    img.title = `${host} · ${count} visits`;
    v.append(img);
    const l = document.createElement("div");
    l.className = "stat-label";
    l.textContent = "Top Site";
    el.append(v, l);
    return el;
  }

  stats.append(numStat(total, "Total Visits"), numStat(siteCount, "Sites"), topStat(top));
}

// The viewport hugs whichever screen is currently shown, so the popup is only
// as tall as the active screen and the height animates during a slide.
function syncHeight() {
  const viewport = document.getElementById("viewport");
  const active = viewport.classList.contains("show-detail")
    ? document.getElementById("detailView")
    : document.getElementById("mainView");
  viewport.style.height = active.scrollHeight + "px";
}

// Wire a list to a bottom-middle chevron: shows the footer only when the list
// overflows, scrolls a page on click, and flips to "up" at the bottom.
// Returns an update() to refresh the arrow after the list content changes.
// alwaysShowFooter: keep the footer row visible (for the credit) and only
// toggle the arrow; otherwise hide the whole footer when there's no overflow.
function setupScrollArrow(listId, footerId, arrowId, alwaysShowFooter = false) {
  const list = document.getElementById(listId);
  const footer = document.getElementById(footerId);
  const arrow = document.getElementById(arrowId);

  function atBottom() {
    return list.scrollTop + list.clientHeight >= list.scrollHeight - 2;
  }

  function update() {
    const overflows = list.scrollHeight > list.clientHeight + 1;
    if (alwaysShowFooter) {
      footer.hidden = false;
      arrow.hidden = !overflows;
    } else {
      footer.hidden = !overflows;
    }
    if (overflows) arrow.classList.toggle("up", atBottom());
  }

  arrow.addEventListener("click", () => {
    list.scrollBy({ top: atBottom() ? -list.clientHeight : list.clientHeight, behavior: "smooth" });
  });
  list.addEventListener("scroll", update);

  return update;
}

const updateArrow = setupScrollArrow("list", "footer", "scrollArrow", true);
const updateTimesArrow = setupScrollArrow("times", "detailFooter", "timesArrow");

document.querySelectorAll(".filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentRange = btn.dataset.range;
    render();
  });
});

// State for the per-site log screen.
let detailHostName = null;
let detailTimes = []; // all visit timestamps for the current host, newest first
let detailRange = "all"; // log's own filter: all | today | week

// Open the log screen for a site. Loads all its visits; the log's own filter
// (left box) decides which range is shown.
async function openDetail(host) {
  const { [STORAGE_KEY]: visits = [] } = await chrome.storage.local.get(STORAGE_KEY);
  detailHostName = host;
  detailTimes = visits
    .filter((v) => v.host === host)
    .map((v) => v.ts)
    .sort((a, b) => b - a);
  detailRange = currentRange; // start matching the main list's range

  document.getElementById("detailFavicon").src = faviconUrl(host);
  document.getElementById("detailHost").textContent = host;

  renderTimes();

  // Slide to the detail screen.
  document.getElementById("detailView").setAttribute("aria-hidden", "false");
  document.getElementById("mainView").setAttribute("aria-hidden", "true");
  document.getElementById("viewport").classList.add("show-detail");
  requestAnimationFrame(syncHeight);
}

// Render the right-side timeline for the current host + detailRange.
function renderTimes() {
  const start = rangeStart(detailRange);
  const times = detailTimes.filter((ts) => ts >= start);

  // Reflect the active filter in the left box.
  document.querySelectorAll(".dfilter").forEach((b) =>
    b.classList.toggle("active", b.dataset.range === detailRange)
  );

  document.getElementById("detailSummary").textContent =
    `${times.length} visit${times.length === 1 ? "" : "s"}`;

  const list = document.getElementById("times");
  list.innerHTML = "";

  if (times.length === 0) {
    const li = document.createElement("li");
    li.className = "tl-empty";
    li.textContent = "No visits in this range.";
    list.appendChild(li);
    requestAnimationFrame(updateTimesArrow);
    return;
  }

  let first = true;
  for (const ts of times) {
    const d = new Date(ts);

    const li = document.createElement("li");
    li.className = "tl-item" + (first ? " latest" : "");
    first = false;

    // Date marker (left): "JUN 6" over the year.
    const date = document.createElement("span");
    date.className = "tl-date";
    const dd = document.createElement("span");
    dd.className = "tl-d";
    dd.textContent = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const yy = document.createElement("span");
    yy.className = "tl-y";
    yy.textContent = d.getFullYear();
    date.append(dd, yy);

    // Line + circle node.
    const node = document.createElement("span");
    node.className = "tl-node";

    // Time (right).
    const time = document.createElement("span");
    time.className = "tl-time";
    time.textContent = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

    li.append(date, node, time);
    list.appendChild(li);
  }

  requestAnimationFrame(updateTimesArrow);
}

document.querySelectorAll(".dfilter").forEach((btn) => {
  btn.addEventListener("click", () => {
    detailRange = btn.dataset.range;
    renderTimes();
    requestAnimationFrame(syncHeight);
  });
});

function closeDetail() {
  // Slide back to the list.
  document.getElementById("detailView").setAttribute("aria-hidden", "true");
  document.getElementById("mainView").setAttribute("aria-hidden", "false");
  document.getElementById("viewport").classList.remove("show-detail");
  requestAnimationFrame(syncHeight);
}

document.getElementById("back").addEventListener("click", closeDetail);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.getElementById("viewport").classList.contains("show-detail")) {
    closeDetail();
  }
});

render();
