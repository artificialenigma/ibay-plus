/* iBay Plus — options page (data management). */

const $ = (sel) => document.querySelector(sel);

const status = (msg, ok = true) => {
  const el = $("#status");
  el.textContent = msg;
  el.style.color = ok ? "#2e7d32" : "#c62828";
  setTimeout(() => { el.textContent = ""; }, 2500);
};

async function renderTable() {
  const { watchlist } = await IBAY_PLUS.load();
  const entries = Object.values(watchlist).sort((a, b) => b.addedAt - a.addedAt);
  $("#empty").style.display = entries.length ? "none" : "block";
  const tbody = $("#items tbody");
  tbody.innerHTML = entries.map((e) => `
    <tr>
      <td><a href="${IBAY_PLUS.esc(e.url)}" target="_blank">${IBAY_PLUS.esc(e.title)}</a></td>
      <td>${IBAY_PLUS.esc(IBAY_PLUS.formatPrice(e.price))}</td>
      <td>${IBAY_PLUS.esc(IBAY_PLUS.formatPrice(e.lastPrice))}</td>
      <td>${IBAY_PLUS.esc(IBAY_PLUS.timeAgo(e.addedAt))}</td>
    </tr>`).join("");
}

$("#export").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(["settings", "watchlist"]);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ibay-plus-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  status("exported ✓");
});

$("#import-file").addEventListener("change", (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(String(reader.result));
      if (typeof data !== "object" || data == null) throw new Error("bad file");
      const current = await chrome.storage.local.get(["settings", "watchlist"]);
      const merged = {
        settings: Object.assign({}, current.settings, data.settings || {}),
        watchlist: Object.assign({}, current.watchlist, data.watchlist || {}),
      };
      await chrome.storage.local.set(merged);
      await renderTable();
      status("imported ✓");
    } catch (e) {
      status("import failed: " + e.message, false);
    }
  };
  reader.readAsText(file);
});

$("#clear-watchlist").addEventListener("click", async () => {
  if (!confirm("Remove ALL watchlist items, notes and price history?")) return;
  await chrome.storage.local.set({ watchlist: {} });
  await renderTable();
  status("watchlist cleared");
});

$("#clear-all").addEventListener("click", async () => {
  if (!confirm("Reset EVERYTHING (watchlist + filters + history)? This cannot be undone.")) return;
  await chrome.storage.local.clear();
  await renderTable();
  status("everything reset");
});

renderTable();
