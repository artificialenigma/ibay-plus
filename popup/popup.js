/* iBay Plus — popup dashboard logic. */

const $ = (sel) => document.querySelector(sel);
const IBAY_POP = IBAY_PLUS; // shared helpers (content/common.js)
IBAY_POP.fmtPrice = IBAY_PLUS.formatPrice;

/* ---------- watchlist tab ---------- */

async function renderWatchlist() {
  const { watchlist } = await IBAY_POP.load();
  const entries = Object.values(watchlist).sort((a, b) => b.addedAt - a.addedAt);

  $("#count").textContent = entries.length ? `${entries.length} saved` : "";
  $("#watch-empty").style.display = entries.length ? "none" : "block";

  const ul = $("#watch-items");
  ul.innerHTML = "";

  for (const e of entries) {
    const li = document.createElement("li");
    li.className = "ibp-item";
    li.dataset.id = e.id;

    const thumb = e.image || "";
    const saved = e.price;
    const known = e.lastPrice;

    let priceLine = `<span class="ibp-item-meta">saved: ${IBAY_POP.esc(IBAY_POP.fmtPrice(saved))}</span>`;
    if (known != null && saved != null && known !== saved) {
      const diff = known - saved;
      const cls = diff < 0 ? "ibp-drop" : "ibp-rise";
      const arrow = diff < 0 ? "▼" : "▲";
      priceLine += ` · <span class="${cls}">${arrow} now ${IBAY_POP.esc(IBAY_POP.fmtPrice(known))}</span>`;
    } else if (known != null) {
      priceLine += ` · now ${IBAY_POP.esc(IBAY_POP.fmtPrice(known))}`;
    }
    const checked = e.lastCheckedAt || e.lastSeenAt;
    if (checked) priceLine += ` <span class="ibp-item-meta">(${IBAY_POP.esc(IBAY_POP.timeAgo(checked))})</span>`;

    li.innerHTML = `
      ${thumb ? `<img class="ibp-thumb" src="${IBAY_POP.esc(thumb)}" alt="">` : ""}
      <div class="ibp-item-main">
        <a class="ibp-item-title" href="${IBAY_POP.esc(e.url)}" target="_blank"
           title="${IBAY_POP.esc(e.title)}">${IBAY_POP.esc(e.title)}</a>
        <div class="ibp-item-meta">${IBAY_POP.esc(e.seller || "")}</div>
        <div class="ibp-price-line">${priceLine}</div>
        ${e.alertBelow != null ? `<div class="ibp-alert-badge">🔔 below ${IBAY_POP.esc(IBAY_POP.fmtPrice(e.alertBelow))}</div>` : ""}
        <textarea class="ibp-note" rows="1"
          placeholder="note…">${IBAY_POP.esc(e.note || "")}</textarea>
        <div class="ibp-item-actions">
          <button type="button" class="ibp-mini ibp-save-note">💾 note</button>
          <button type="button" class="ibp-mini ibp-check-one">⟳ price</button>
          <button type="button" class="ibp-mini ibp-remove">✕ remove</button>
        </div>
      </div>`;
    ul.appendChild(li);
  }

  ul.querySelectorAll(".ibp-save-note").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.closest(".ibp-item").dataset.id;
      const note = btn.closest(".ibp-item").querySelector(".ibp-note").value;
      const { watchlist } = await IBAY_POP.load();
      if (watchlist[id]) {
        watchlist[id].note = note;
        await IBAY_POP.save({ watchlist });
        btn.textContent = "✓ saved";
        setTimeout(() => { btn.textContent = "💾 note"; }, 1200);
      }
    });
  });

  ul.querySelectorAll(".ibp-check-one").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.closest(".ibp-item").dataset.id;
      btn.textContent = "…";
      const res = await chrome.runtime.sendMessage({ type: "ibayplus:checkOne", id });
      btn.textContent = res && res.ok
        ? (res.price != null ? IBAY_POP.fmtPrice(res.price) : "no price")
        : "error";
      setTimeout(() => renderWatchlist(), 1500);
    });
  });

  ul.querySelectorAll(".ibp-remove").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.closest(".ibp-item").dataset.id;
      const { watchlist } = await IBAY_POP.load();
      delete watchlist[id];
      await IBAY_POP.save({ watchlist });
      renderWatchlist();
    });
  });
}

/* check-all button */
$("#check-now").addEventListener("click", async () => {
  const status = $("#check-status");
  status.textContent = "checking…";
  const res = await chrome.runtime.sendMessage({ type: "ibayplus:checkPrices" });
  if (!res || !res.ok) {
    status.textContent = "check failed: " + (res ? res.error : "no response");
    return;
  }
  const changed = res.results.filter((r) => r.ok && r.changed).length;
  const failed = res.results.filter((r) => !r.ok).length;
  status.textContent = `done · ${res.results.length} items · ${changed} changed` +
    (failed ? ` · ${failed} failed` : "");
  renderWatchlist();
});

$("#open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());

/* ---------- filters tab ---------- */

async function renderFilters() {
  const { settings } = await IBAY_POP.load();
  $("#hide-keywords").value = settings.hideKeywords.join(", ");
  $("#highlight-keywords").value = settings.highlightKeywords.join(", ");
  $("#alerts-enabled").checked = settings.alertsEnabled !== false;
}

$("#save-filters").addEventListener("click", async () => {
  const split = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);
  await IBAY_POP.save({
    settings: {
      hideKeywords: split($("#hide-keywords").value),
      highlightKeywords: split($("#highlight-keywords").value),
      alertsEnabled: $("#alerts-enabled").checked,
    },
  });
  const st = $("#filter-status");
  st.textContent = "saved ✓";
  setTimeout(() => { st.textContent = ""; }, 2000);
});

/* ---------- tabs ---------- */

document.querySelectorAll(".ibp-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".ibp-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".ibp-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(`#tab-${tab.dataset.tab}`).classList.add("active");
  });
});

/* ---------- boot ---------- */

(async () => {
  await renderWatchlist();
  await renderFilters();
})();
