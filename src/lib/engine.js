/* ============================================================================
   Shared logic (adapted from shared/engine.js)
   ----------------------------------------------------------------------------
   The engine owns data access and every rule: language, money, catalogue,
   search, sort, the cart (catalogue items + custom-text pins), pricing and the
   WhatsApp order message. The page owns markup, layout and motion.

   Changes from the original engine:
   - reads business.json: one level of categories, each holding items directly,
     items are bilingual (name_en / name_ar); category, location and city
     names are a single English "name"; a separate top-level "location" adds
     one nested level (Location → cities → items)
   - USD only (lbp(), dual() and the exchange rate are gone)
   - no stock figures, so quantities are no longer clamped to stock
   - a second cart collection for custom-text pins
   - totals() delegates to bulkPricing() in pricing.js
   - orderText() produces the new receipt format
   ============================================================================ */

import I18N from "./i18n.js";
import { bulkPricing, normalizeTiers, WHOLESALE_LIMIT } from "./pricing.js";

/** Largest quantity a single line accepts; keeps typed input sane. */
var MAX_QTY = 99999;

/** Separators used by orderText(), exactly as the shop specified them. */
var RULE_TOP = "———————————————————";
var RULE_BOTTOM = "----------------------------------------------------------------";

/** Message sections, in their fixed order in the WhatsApp text. */
var SECTIONS = [
  { key: "pins", title: "PINS" },
  { key: "family", title: "FAMILY NAMES" },
  { key: "places", title: "PLACES" }
];

export function createEngine(business) {
  "use strict";

  var brand = business.brand;
  /* pricing tiers: business.json "pricingTiers" (validated, sorted by min) */
  var tiers = normalizeTiers(business.pricingTiers);

  /* ------------------------------------------------------------ language */
  var lang = "en";
  var listeners = [];

  function t(key) {
    var pack = I18N[lang] || I18N.en;
    return pack[key] != null ? pack[key] : (I18N.en[key] != null ? I18N.en[key] : key);
  }
  /** t() with {placeholders} filled in. */
  function tf(key, vars) {
    return t(key).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
  }
  function getLang() { return lang; }
  function dir() { return lang === "ar" ? "rtl" : "ltr"; }
  function isRtl() { return lang === "ar"; }
  function setLang(next) {
    lang = next === "ar" ? "ar" : "en";
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
      document.documentElement.dir = dir();
    }
    emit();
  }
  function toggleLang() { setLang(lang === "ar" ? "en" : "ar"); }
  /** A business.json field in the active language: `<name>_ar` / `<name>_en`,
      or a plain single-language `<name>` (category, location and city names
      are English-only and read as-is in both languages). */
  function field(obj, name) {
    if (!obj) return "";
    return obj[name + "_" + lang] || obj[name + "_en"] || obj[name] || "";
  }
  function nameOf(obj) { return field(obj, "name"); }

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(function (f) { f(); }); }

  /* --------------------------------------------------------------- money */
  function usd(value) {
    return "$" + (Math.round(value * 100) / 100).toFixed(2);
  }

  /* ----------------------------------------------------------- catalogue */
  /* Two sources in business.json, one node model:
       categories[]      → flat category nodes, each holding items
       location          → ONE group node (kind "location", type "custom")
       location.cities[] → city nodes under it, each holding items; they
                           behave like custom categories (Create your own)
     business.json has no ids, so nodes get URL-safe slugs from their English
     name ("marble", "location", "location/beirut") and items a positional id
     inside their node ("marble:0", "location/beirut:1"). */
  function slug(s) {
    return String(s || "").toLowerCase().trim()
      .replace(/[^a-z0-9؀-ۿ]+/g, "-").replace(/^-+|-+$/g, "") || "category";
  }
  var seen = {};
  function uniq(id) {
    var out = id, n = 2;
    while (seen[out]) out = id + "-" + n++;
    seen[out] = true;
    return out;
  }
  function itemsOf(list, nodeId) {
    return (list || []).map(function (it, ii) {
      return {
        id: nodeId + ":" + ii,
        categoryId: nodeId,
        name_en: it.name_en,
        name_ar: it.name_ar,
        photo: it.photo || "",
        listPriceUsd: it.price
      };
    });
  }

  var categories = (business.categories || []).map(function (c) {
    var id = uniq(slug(c.name));
    return { id: id, kind: "category", type: c.type === "custom" ? "custom" : "normal",
      name: c.name, items: itemsOf(c.items, id) };
  });

  var locNode = null;
  if (business.location && Array.isArray(business.location.cities)) {
    var locId = uniq(slug(business.location.name || "location"));
    locNode = { id: locId, kind: "location", type: "custom", name: business.location.name || "Location", items: [] };
    locNode.cities = business.location.cities.map(function (city) {
      var id = uniq(locId + "/" + slug(city.name));
      return { id: id, kind: "city", type: "custom", parentId: locId, name: city.name, items: itemsOf(city.items, id) };
    });
  }

  /* Every node that directly holds items (categories + cities), and every node. */
  var leaves = categories.concat(locNode ? locNode.cities : []);
  var allNodes = categories.concat(locNode ? [locNode].concat(locNode.cities) : []);

  var byId = {}, productIndex = {}, allProducts = [];
  allNodes.forEach(function (n) { byId[n.id] = n; });
  leaves.forEach(function (n) {
    n.items.forEach(function (p) { productIndex[p.id] = p; allProducts.push(p); });
  });

  function roots() { return categories; }
  /** Rail/section contents. "custom" = custom categories + the Location node. */
  function byType(type) {
    var list = categories.filter(function (c) { return c.type === type; });
    return type === "custom" && locNode ? list.concat([locNode]) : list;
  }
  function node(id) { return byId[id] || null; }
  /** Nodes whose grid ends with the "Create your own" tile. */
  function isCustom(c) { return !!c && c.type === "custom" && !c.cities; }
  /** Pure navigation nodes (Location): show child tiles, no products. */
  function isGroup(c) { return !!c && !!c.cities; }
  function children(c) { return c && c.cities ? c.cities : []; }
  function parentOf(c) { return c && c.parentId ? byId[c.parentId] : null; }
  function productsIn(c) { return c ? c.items : []; }
  function productById(id) { return productIndex[id] || null; }
  function categoryOf(p) { return p ? byId[p.categoryId] : null; }
  /** Which message section a node's entries belong to, from its structure
      (never its name): a Location city → "places", a custom-type category
      (Family Names) → "family", a normal category → "pins". */
  function sectionOf(n) {
    if (!n) return "pins";
    if (n.kind === "city") return "places";
    return n.type === "custom" ? "family" : "pins";
  }

  /** [{ label: "All", path: "" }, …, { label: "Beirut", path: "location/beirut" }] */
  function breadcrumb(id) {
    var crumbs = [{ label: t("allCategories"), path: "" }];
    var chain = [], c = node(id);
    while (c) { chain.unshift(c); c = parentOf(c); }
    chain.forEach(function (n) { crumbs.push({ label: nameOf(n), path: n.id }); });
    return crumbs;
  }

  /** "3 items" / "2 cities" in the active language. */
  function countLabel(c) {
    if (!c) return "";
    if (c.cities) return c.cities.length + " " + t(c.cities.length === 1 ? "city" : "cities");
    var n = c.items.length;
    return n + " " + t(n === 1 ? "product" : "products");
  }

  var totalsInfo = {
    products: allProducts.length,
    categories: categories.length + (locNode ? 1 : 0)
  };

  /* -------------------------------------------------------------- search */
  /* Case-insensitive; Arabic diacritics and tatweel are ignored so "رخام"
     still matches "رُخام". */
  function norm(s) {
    return String(s || "").toLowerCase().replace(/[ً-ٰٟـ]/g, "").trim();
  }

  /* Matches item names in the ACTIVE language (name_en or name_ar), plus
     category, Location and city names (English-only, so they match in both
     languages). Items inside a matching node are results too; a match on the
     Location node covers every city's items.
     Returns { nodes, products, query }. */
  function search(query) {
    var q = norm(query);
    if (!q) return { products: [], nodes: [], query: "" };

    var nodes = allNodes.filter(function (n) { return norm(nameOf(n)).indexOf(q) > -1; });
    var products = [];
    leaves.forEach(function (n) {
      var nodeHit = nodes.indexOf(n) > -1 || nodes.indexOf(parentOf(n)) > -1;
      n.items.forEach(function (p) {
        if (nodeHit || norm(nameOf(p)).indexOf(q) > -1) products.push(p);
      });
    });
    return { products: products, nodes: nodes, query: query };
  }

  /* ---------------------------------------------------------------- sort */
  var SORTS = ["", "name-asc", "name-desc"];
  function sortLabel(mode) {
    return mode === "name-asc" ? t("sortNameAsc")
      : mode === "name-desc" ? t("sortNameDesc")
      : t("sortDefault");
  }
  function sortProducts(list, mode) {
    var out = list.slice();
    var cmp = function (a, b) {
      return nameOf(a).localeCompare(nameOf(b), lang, { numeric: true, sensitivity: "base" });
    };
    if (mode === "name-asc") out.sort(cmp);
    else if (mode === "name-desc") out.sort(function (a, b) { return cmp(b, a); });
    return out;
  }
  function filterProducts(list, query) {
    var q = norm(query);
    if (!q) return list;
    return list.filter(function (p) { return norm(nameOf(p)).indexOf(q) > -1; });
  }

  /* ---------------------------------------------------------------- cart */
  /* Two collections, in memory only:
       cart    — catalogue items, productId -> qty (as before)
       customs — custom-text pins,
                 [{ id, categoryId, categoryName, section, text, qty }]
                 `section` ("family" | "places") is set when the entry is
                 added, from where it was added
     Every cart function below takes a "line id", which is either a product id
     or a custom pin's generated id, so steppers and remove buttons work the
     same for both kinds. */
  var cart = {};
  var customs = [];

  function newId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    /* crypto.randomUUID needs a secure context (https or localhost). */
    return "c-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
  function clampQty(v) { return Math.max(0, Math.min(MAX_QTY, Math.floor(Number(v) || 0))); }
  function customById(id) {
    for (var i = 0; i < customs.length; i++) if (customs[i].id === id) return customs[i];
    return null;
  }

  function qtyOf(id) {
    if (cart[id]) return cart[id];
    var c = customById(id);
    return c ? c.qty : 0;
  }

  /** Set a line to an exact quantity; 0 removes it. Returns the new qty. */
  function setQty(id, value) {
    var next = clampQty(value);
    if (productById(id)) {
      if (next === 0) delete cart[id]; else cart[id] = next;
    } else {
      var c = customById(id);
      if (!c) return 0;
      if (next === 0) customs.splice(customs.indexOf(c), 1); else c.qty = next;
    }
    emit();
    return next;
  }
  /** Change a line by delta. Returns the new qty. */
  function bump(id, delta) { return setQty(id, qtyOf(id) + delta); }
  function remove(id) { setQty(id, 0); }
  function clearCart() { cart = {}; customs = []; emit(); }

  /** Add one custom-text pin line, tagged with its message section. Adding
      the same text again in the same category/city adds to that line's
      quantity instead of creating a duplicate line. Returns the entry, or
      null if invalid. */
  function addCustom(categoryId, text, qty) {
    var cat = node(categoryId);
    var clean = String(text || "").replace(/\s+/g, " ").trim();
    var n = clampQty(qty);
    if (!cat || !clean || n < 1) return null;
    var key = clean.toLowerCase();
    var entry = customs.filter(function (c) { return c.categoryId === cat.id && c.text.toLowerCase() === key; })[0];
    if (entry) entry.qty = clampQty(entry.qty + n);
    else {
      entry = { id: newId(), categoryId: cat.id, categoryName: cat.name, section: sectionOf(cat), text: clean, qty: n };
      customs.push(entry);
    }
    emit();
    return entry;
  }
  function customsIn(categoryId) {
    return customs.filter(function (c) { return c.categoryId === categoryId; });
  }

  function count() {
    var a = Object.keys(cart).reduce(function (s, id) { return s + cart[id]; }, 0);
    return customs.reduce(function (s, c) { return s + c.qty; }, a);
  }

  /** Pins that count toward the wholesale threshold: catalogue-cart items
      from "normal"-type categories only (never Family Names or Places). */
  function catalogPinQty() {
    return Object.keys(cart).reduce(function (s, id) {
      return sectionOf(categoryOf(productById(id))) === "pins" ? s + cart[id] : s;
    }, 0);
  }

  /** Every cart line, catalogue items first, then custom pins, each priced at
      the cart-wide tier rate (null for a wholesale order) and tagged with its
      message section. */
  function lines() {
    var unit = bulkPricing(count(), tiers, catalogPinQty()).unitUsd;
    var price = function (qty) { return unit == null ? null : Math.round(unit * 100) * qty / 100; };

    var items = Object.keys(cart).map(function (id) {
      var p = productById(id);
      return {
        id: id, kind: "item", product: p, qty: cart[id],
        section: sectionOf(categoryOf(p)),
        label: nameOf(p),
        code: p.name_en,                 /* what the shop sees in the message */
        where: nameOf(categoryOf(p)),
        unitUsd: unit, lineUsd: price(cart[id])
      };
    });
    var own = customs.map(function (c) {
      return {
        id: c.id, kind: "custom", custom: c, qty: c.qty,
        section: c.section,
        label: c.text,
        code: c.text,
        where: nameOf(node(c.categoryId)) + " · " + t("customPin"),
        unitUsd: unit, lineUsd: price(c.qty)
      };
    });
    return items.concat(own);
  }

  /** Cart totals: the bulkPricing() result for the combined quantity (and the
      catalogue-pin count that decides wholesale), plus the number of lines. */
  function totals() {
    var pins = catalogPinQty();
    var p = bulkPricing(count(), tiers, pins);
    p.lines = Object.keys(cart).length + customs.length;
    p.count = p.qty;
    p.pinQty = pins;
    return p;
  }

  /* ------------------------------------------------------------- whatsapp */
  function pad(n) { return String(n).padStart(2, "0"); }

  /** The exact text sent to the shop on WhatsApp. `when` defaults to now.
      Labels stay in English whatever the UI language, so every order the shop
      receives reads the same way.

      Item lines are grouped PINS → FAMILY NAMES → PLACES whatever order they
      were added in, one line per cart entry with its final quantity. Section
      titles are written only when the order spans more than one section, so a
      single-section order reads exactly as before.
      For a wholesale order (> WHOLESALE_LIMIT catalogue pins) the price and
      delivery lines are replaced by a line pointing to the shop for pricing. */
  function orderText(when) {
    var d = when || new Date();
    var tt = totals();
    var ls = lines();
    var groups = SECTIONS.map(function (s) {
      return { title: s.title, lines: ls.filter(function (l) { return l.section === s.key; }) };
    }).filter(function (g) { return g.lines.length; });
    var titled = groups.length > 1;

    var L = [];
    L.push(pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear());
    L.push(pad(d.getHours()) + ":" + pad(d.getMinutes()));
    L.push("");
    L.push(RULE_TOP);
    L.push("");
    groups.forEach(function (g, gi) {
      if (titled) {
        if (gi) L.push("");
        L.push(g.title);
      }
      g.lines.forEach(function (l) { L.push(l.code + "  " + l.qty); });
    });
    L.push("");
    L.push(RULE_BOTTOM);
    L.push("total number of items: " + tt.count);
    if (tt.wholesale) {
      L.push("total price: wholesale order (more than " + WHOLESALE_LIMIT + " pins)");
      L.push("pricing: contact " + brand.name + " directly on WhatsApp " + brand.whatsapp);
    } else {
      L.push("total price: " + usd(tt.totalUsd));
      L.push("delivery: " + (tt.deliveryUsd === 0 ? "Free" : usd(tt.deliveryUsd)));
    }
    return L.join("\n");
  }

  function waNumber() { return String(brand.whatsapp || "").replace(/\D/g, ""); }
  function whatsappUrl(when) {
    return "https://wa.me/" + waNumber() + "?text=" + encodeURIComponent(orderText(when));
  }

  /* ----------------------------------------------------------- utilities */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* Hash router: #/<categoryId>, #/categories, #/cart, #/checkout, #/search=… */
  function parseHash() {
    var h = (window.location.hash || "").replace(/^#\/?/, "");
    if (!h) return { view: "home", path: "" };
    if (h === "cart" || h === "checkout" || h === "categories") return { view: h, path: "" };
    if (h.indexOf("search=") === 0) return { view: "search", q: decodeURIComponent(h.slice(7)), path: "" };
    return { view: "node", path: decodeURIComponent(h) };
  }
  function goTo(hash) { window.location.hash = "#/" + hash; }

  return {
    brand: brand,
    totalsInfo: totalsInfo,
    WHOLESALE_LIMIT: WHOLESALE_LIMIT,
    /* language */
    t: t, tf: tf, getLang: getLang, setLang: setLang, toggleLang: toggleLang, dir: dir, isRtl: isRtl,
    field: field, nameOf: nameOf, onChange: onChange, emit: emit,
    /* money */
    usd: usd,
    /* catalogue */
    tiers: tiers,
    roots: roots, byType: byType, node: node, isCustom: isCustom, isGroup: isGroup, children: children,
    parentOf: parentOf, productsIn: productsIn,
    productById: productById, categoryOf: categoryOf, breadcrumb: breadcrumb, countLabel: countLabel,
    /* find */
    search: search, sortProducts: sortProducts, filterProducts: filterProducts,
    sortLabel: sortLabel, SORTS: SORTS,
    /* cart */
    qtyOf: qtyOf, bump: bump, setQty: setQty, remove: remove, clearCart: clearCart,
    addCustom: addCustom, customsIn: customsIn,
    lines: lines, count: count, catalogPinQty: catalogPinQty, totals: totals, sectionOf: sectionOf,
    /* order */
    orderText: orderText, whatsappUrl: whatsappUrl,
    /* misc */
    esc: esc, parseHash: parseHash, goTo: goTo
  };
}
