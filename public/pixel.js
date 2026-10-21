/*
 * Komorebi pixel. Loaded through GTM on the offering's landing + checkout pages.
 *
 *   komorebi('init', { offer: 'autocamp' });          // once, on every page
 *   komorebi('track', 'lead', { investor_id: '...' }); // at each funnel step
 *
 * Only visitors who arrived with a ClickFlare cf_click_id are tracked; everyone else
 * on the offer's site is ignored (no cookie, no storage, no requests).
 *
 * On every page it captures click IDs and UTMs from the URL, keeps first- and
 * last-touch attribution in first-party storage, and attaches them to every
 * event sent to /api/collect.
 */
(function (window, document) {
  "use strict";

  // Events go to the same host that serves this script.
  var script = document.currentScript;
  var ENDPOINT = (script ? new URL(script.src).origin : "https://komorebi-attribution.vercel.app") + "/api/collect";
  var STORAGE_KEY = "kmb_attr";
  var VISITOR_COOKIE = "kmb_vid";
  var CLICK_PARAMS = [
    "fbclid", "gclid", "gbraid", "wbraid", "ttclid", "msclkid",
    "clickid", "click_id", "cf_click_id", "_ef_transaction_id",
    "campaign_id", "adset_id", "ad_id", "placement"
  ];
  // Never sent in clear text; hashed with SHA-256 if provided.
  var HASHED_FIELDS = ["email", "phone"];

  var stub = window.komorebi;
  var queue = (stub && stub.q) || [];
  if (stub && stub.loaded) return;

  var config = { offer: null };

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function readCookie(name) {
    var match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function writeCookie(name, value, days) {
    var expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = name + "=" + encodeURIComponent(value) + "; expires=" + expires + "; path=/; SameSite=Lax";
  }

  function load() {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function save(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }

  function isEmpty(value) {
    return !value || value === "(none)" || value === "none" || value === "direct";
  }

  // utm_* and known click IDs present in the current URL.
  function urlParams() {
    var params = {};
    var search = new URLSearchParams(window.location.search);
    search.forEach(function (value, key) {
      if ((key.indexOf("utm_") === 0 || CLICK_PARAMS.indexOf(key) !== -1) && !isEmpty(value)) {
        params[key] = value;
      }
    });
    return params;
  }

  function externalReferrer() {
    try {
      return document.referrer && new URL(document.referrer).hostname !== window.location.hostname
        ? document.referrer
        : null;
    } catch {
      return null;
    }
  }

  function visitorId() {
    var id = readCookie(VISITOR_COOKIE) || load().visitor_id || uuid();
    writeCookie(VISITOR_COOKIE, id, 365);
    return id;
  }

  // Meta's _fbc cookie, or one built from fbclid if the Meta pixel hasn't set it yet.
  function fbc(touch) {
    var cookie = readCookie("_fbc");
    if (cookie) return cookie;
    return touch && touch.fbclid ? "fb.1." + touch.landed_at_ms + "." + touch.fbclid : null;
  }

  // Only visitors who arrived through a Komorebi (ClickFlare) click are tracked.
  // Everyone else gets no cookie, no storage and no requests.
  function isKomorebi(state, params) {
    return !!(params.cf_click_id ||
      (state.first && state.first.cf_click_id) ||
      (state.last && state.last.cf_click_id));
  }

  function captureTouch() {
    var state = load();
    var params = urlParams();
    var referrer = externalReferrer();

    if (!isKomorebi(state, params)) return null;

    state.visitor_id = visitorId();

    // A new touch is an arrival from outside the site, or any URL carrying attribution params.
    // Internal links that only carry DealMaker's default "direct" UTMs are filtered out by isEmpty().
    var hasParams = Object.keys(params).length > 0;
    if (hasParams || (referrer && !state.last)) {
      var touch = params;
      touch.landing_url = window.location.href;
      touch.referrer = referrer;
      touch.landed_at = new Date().toISOString();
      touch.landed_at_ms = Date.now();

      if (!state.first) state.first = touch;
      state.last = touch;
    }

    save(state);
    return state;
  }

  function sha256(value) {
    var normalized = String(value).trim().toLowerCase();
    if (!window.crypto || !window.crypto.subtle || !window.TextEncoder) return Promise.resolve(null);
    return window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized)).then(function (buffer) {
      return Array.prototype.map.call(new Uint8Array(buffer), function (b) {
        return ("0" + b.toString(16)).slice(-2);
      }).join("");
    });
  }

  function cleanData(data) {
    var clean = {};
    var hashes = [];

    Object.keys(data || {}).forEach(function (key) {
      var value = data[key];
      if (value === undefined || value === null || value === "") return;

      if (HASHED_FIELDS.indexOf(key) !== -1) {
        hashes.push(sha256(value).then(function (hash) {
          if (hash) clean[key + "_sha256"] = hash;
        }));
      } else {
        clean[key] = value;
      }
    });

    return Promise.all(hashes).then(function () {
      return clean;
    });
  }

  function send(body) {
    var json = JSON.stringify(body);
    var blob = new Blob([json], { type: "text/plain" });

    if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, blob)) return;

    if (window.fetch) {
      window.fetch(ENDPOINT, { method: "POST", body: json, keepalive: true, mode: "cors" })["catch"](function () {});
    }
  }

  function track(event, data) {
    var state = captureTouch();
    if (!state) return;

    cleanData(data).then(function (clean) {
      send({
        event: event,
        event_id: (data && data.event_id) || uuid(),
        offer: config.offer,
        visitor_id: state.visitor_id,
        sent_at: new Date().toISOString(),
        page_url: window.location.href,
        page_referrer: document.referrer || null,
        first_touch: state.first || null,
        last_touch: state.last || null,
        fbp: readCookie("_fbp"),
        fbc: fbc(state.last),
        data: clean
      });
    });
  }

  var commands = {
    init: function (options) {
      for (var key in options) config[key] = options[key];
      track("page_view");
    },
    track: track
  };

  function komorebi(command) {
    var handler = commands[command];
    if (handler) {
      try {
        handler.apply(null, Array.prototype.slice.call(arguments, 1));
      } catch {}
    }
  }

  komorebi.loaded = true;
  window.komorebi = komorebi;

  // init must run before any queued track call.
  queue.sort(function (a, b) {
    return (a[0] === "init" ? 0 : 1) - (b[0] === "init" ? 0 : 1);
  });
  for (var i = 0; i < queue.length; i++) komorebi.apply(null, queue[i]);
})(window, document);
