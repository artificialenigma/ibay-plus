/* iBay Plus — item detail page enhancements:
   - records price history automatically on every visit
   - inline panel: save to watchlist, private note, price-drop alert,
     history summary (first seen / lowest / last change)
   - quick "copy phone number" button next to the call button */

(function () {
  "use strict";

  function currentItem() {
    const id = IBAY_PLUS.itemIdFromUrl(location.href);
    if (!id) return null;

    const titleEl = document.querySelector(".iw-details-heading h5") ||
                    document.querySelector("h5");
    const priceEl = document.querySelector(".iw-price-row .price") ||
                    document.querySelector(".price");
    const imgMeta = document.querySelector('meta[property="og:image"]');
    const sellerA = document.querySelector(".iw-by-seller a") ||
                    document.querySelector('a[href*="page=profile&id="]');
    const galleryImg = document.querySelector(".gallery a[href]");

    return {
      id,
      url: location.origin + location.pathname,
      title: titleEl ? titleEl.textContent.trim() : document.title.replace(" | iBay", ""),
      price: priceEl ? IBAY_PLUS.parsePrice(priceEl.textContent) : null,
      image: imgMeta ? imgMeta.content : (galleryImg ? galleryImg.getAttribute("href") : null),
      seller: sellerA ? sellerA.textContent.trim() : "",
      sellerUrl: sellerA ? sellerA.href : "",
    };
  }

  /** Record this visit's price into history (dedup: only when changed). */
  async function recordPrice(item) {
    const { watchlist } = await IBAY_PLUS.load();
    const w = watchlist[item.id];
    if (!w) return false; // history tracked only for watchlisted items

    const changed = w.lastPrice !== item.price;
    if (changed) {
      w.lastPrice = item.price;
      w.price = w.price == null ? item.price : w.price; // keep original saved price
      w.history = (w.history || []).concat([{ t: Date.now(), p: item.price }]);
    }
    w.lastSeenAt = Date.now();
    await IBAY_PLUS.save({ watchlist });
    return changed;
  }

  function buildPanel(item, entry, settings) {
    const panel = document.createElement("div");
    panel.className = "ibp-panel";
    panel.innerHTML = `
      <div class="ibp-panel-head">
        <span class="ibp-panel-title">iBay Plus</span>
        <button type="button" class="ibp-panel-watch"></button>
        <span class="ibp-panel-status"></span>
      </div>
      <div class="ibp-panel-body">
        <div class="ibp-hist"></div>
        <div class="ibp-alert-row">
          <label>Alert me below: MVR <input type="number" class="ibp-alert-input" min="0" step="1"></label>
          <button type="button" class="ibp-alert-btn">Set alert</button>
        </div>
        <div class="ibp-note-row">
          <textarea class="ibp-note" rows="2" placeholder="Private note (saved locally)…"></textarea>
          <button type="button" class="ibp-note-btn">Save note</button>
        </div>
      </div>`;

    const watchBtn = panel.querySelector(".ibp-panel-watch");
    const status = panel.querySelector(".ibp-panel-status");
    const hist = panel.querySelector(".ibp-hist");
    const alertInput = panel.querySelector(".ibp-alert-input");
    const note = panel.querySelector(".ibp-note");

    const sync = (entry) => {
      const watched = !!entry;
      watchBtn.textContent = watched ? "♥ On watchlist" : "♡ Save to watchlist";
      watchBtn.classList.toggle("ibp-watched", watched);

      if (watched) {
        const h = (entry.history || []).filter((x) => x.p != null);
        const first = h.length ? h[0].p : entry.price;
        const lowest = h.length ? Math.min(...h.map((x) => x.p)) : entry.price;
        const lastChange = h.length > 1 ? h[h.length - 1].t : null;
        const parts = [];
        parts.push(`first seen: ${IBAY_PLUS.formatPrice(first)}`);
        if (lowest != null && first != null && lowest < first) {
          parts.push(`lowest: ${IBAY_PLUS.formatPrice(lowest)}`);
        }
        if (lastChange) parts.push(`changed ${IBAY_PLUS.timeAgo(lastChange)}`);
        if (!h.length) parts.push("price history will build up as you revisit");
        hist.innerHTML = parts.map(IBAY_PLUS.esc).join(" · ");
        alertInput.value = entry.alertBelow == null ? "" : entry.alertBelow;
        note.value = entry.note || "";
        status.textContent = entry.alertBelow != null ? "🔔 alert armed" : "";
      } else {
        hist.textContent = "Save it to start tracking this price.";
        alertInput.value = "";
        note.value = "";
        status.textContent = "";
      }
    };

    watchBtn.addEventListener("click", async () => {
      const { watchlist, settings } = await IBAY_PLUS.load();
      let entry = watchlist[item.id];
      if (entry) {
        delete watchlist[item.id];
      } else {
        entry = {
          id: item.id,
          url: item.url,
          title: item.title,
          price: item.price,
          image: item.image,
          seller: item.seller,
          sellerUrl: item.sellerUrl,
          note: "",
          addedAt: Date.now(),
          lastSeenAt: Date.now(),
          lastPrice: item.price,
          history: item.price != null ? [{ t: Date.now(), p: item.price }] : [],
          alertBelow: null,
        };
        watchlist[item.id] = entry;
      }
      await IBAY_PLUS.save({ watchlist });
      sync(watchlist[item.id]);
    });

    panel.querySelector(".ibp-alert-btn").addEventListener("click", async () => {
      const { watchlist, settings } = await IBAY_PLUS.load();
      const entry = watchlist[item.id];
      if (!entry) { status.textContent = "save it first ♥"; return; }
      const v = parseFloat(alertInput.value);
      entry.alertBelow = Number.isFinite(v) && v >= 0 ? v : null;
      await IBAY_PLUS.save({ watchlist });
      status.textContent = entry.alertBelow != null
        ? `🔔 will alert below MVR ${entry.alertBelow.toLocaleString()}` : "alert cleared";
    });

    panel.querySelector(".ibp-note-btn").addEventListener("click", async () => {
      const { watchlist, settings } = await IBAY_PLUS.load();
      const entry = watchlist[item.id];
      if (!entry) { status.textContent = "save it first ♥"; return; }
      entry.note = note.value;
      await IBAY_PLUS.save({ watchlist });
      status.textContent = "note saved ✓";
      setTimeout(() => { status.textContent = ""; }, 2000);
    });

    sync(entry);
    return panel;
  }

  /** Small "copy number" chip next to the site's call button. */
  function addCopyPhoneBtn() {
    const tel = document.querySelector('a[href^="tel:"]');
    if (!tel) return;
    const num = tel.getAttribute("href").replace("tel:", "").trim();
    if (!num) return;
    const btn = document.createElement("a");
    btn.className = "ibp-copy-btn waves-effect btn-flat";
    btn.href = "#";
    btn.textContent = "📋 copy";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      navigator.clipboard.writeText(num).then(() => {
        btn.textContent = "✓ copied";
        setTimeout(() => { btn.textContent = "📋 copy"; }, 1500);
      });
    });
    tel.parentElement.appendChild(btn);
  }

  async function run() {
    const item = currentItem();
    if (!item) return;

    await recordPrice(item);

    const { watchlist, settings } = await IBAY_PLUS.load();

    // panel under the price row
    const priceRow = document.querySelector(".iw-price-row");
    if (priceRow && !document.querySelector(".ibp-panel")) {
      priceRow.parentElement.insertBefore(
        buildPanel(item, watchlist[item.id], settings), priceRow.nextSibling);
    }

    addCopyPhoneBtn();
  }

  run();
})();
