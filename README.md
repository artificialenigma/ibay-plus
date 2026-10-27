# iBay Plus

A Chrome extension that adds extra functionality to [ibay.com.mv](https://ibay.com.mv/) —
the Maldives marketplace. Everything is stored **locally on your machine**; nothing is sent
anywhere except price checks of the item pages you watch.

## Features

| Feature | What it does |
|---|---|
| **Local watchlist + notes** | ♡ button on every listing card and item page. Works without an ibay account. Notes are private and stored locally. |
| **Price tracking** | Whenever you open a watchlisted item, its price is recorded. The background checker re-fetches watched pages every 30 minutes. |
| **Price-drop alerts** | Desktop notification when a watched price drops (or falls below a threshold you set per item). Clicking the notification opens the listing. |
| "Since saved" badges | Listing cards of watched items show how the current price compares to when you saved it. |
| **Keyword filter** | Hide listings containing keywords (e.g. `wanted`) — with a bar to reveal them. |
| **Keyword highlight** | Star-highlight listings containing keywords you're hunting (e.g. `iphone 15`, `ps5`). |
| **Price filter** | 💰 bar at the top of any listing feed — set a MVR min/max range and matching posts hide instantly as you type. Optional "hide price not stated" toggle. The range sticks while you page through results; click *clear* to reset. |
| **Spam removal** | Auto-hide spam posts from listings: titles with 3+ phone numbers, junk character runs (`!!!!`, `-----`, emoji floods), opt-in ALL-CAPS detection, plus a **🚫 hide-seller** button on every card (undo toast included) and an optional flood cap that collapses sellers posting more than N listings in a feed. Toggle everything in the popup under *Filters*. |
| **Quick copy phone** | One-tap copy of the seller's number on item pages. |
| **Export / import** | JSON backup of your watchlist, notes and history in the options page. |

## Install (Developer mode)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select this `ibay-plus` folder
4. Pin "iBay Plus" from the puzzle-piece menu

## Usage

- Browse ibay.com.mv as usual — heart buttons appear on listings.
- **Popup**: view your watchlist, edit notes, set per-item alert thresholds,
  run a manual "Check prices now", and configure keyword filters.
- **Options page** (right-click the toolbar icon → Options): table of saved items,
  export/import backups, clear data.

## Files

```
manifest.json          MV3 manifest
background.js          price checker (alarms + notifications)
content/common.js      shared helpers (price parse, item id, formatting)
content/listings.js    listing cards: watch btn, filters, badges
content/item.js        item page: price history, panel, copy phone
popup/                 toolbar dashboard (watchlist + filters)
options/               data management page
styles/content.css     styles injected into ibay pages
make_icons.py          regenerates icons/*.png (requires Pillow)
```

## How it tracks prices

- Item URLs end with `-o<id>.html`; the item id is parsed from that.
- The main price is read from the first `.price` element (inside `.iw-price-row`)
  on the item page — matching the site's current markup.
- History per item is capped at 100 points in `chrome.storage.local`.

If ibay changes its HTML later, update the selectors in `content/listings.js`,
`content/item.js` and the regex in `background.js:parsePriceFromHtml`.

## Notes & limits

- Notifications and background checks only work while Chrome is running.
- The extension requests host permission for `ibay.com.mv` so it can inject
  the UI and fetch watched item pages for price checks.
- Not affiliated with ibay.com.mv.
