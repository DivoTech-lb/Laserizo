/* =============================================================================
   PULSE — behaviour (adapted from sample 3)
   business.json is imported here, so Vite bundles the content into the page
   at build time.
   ========================================================================== */
import business from "../data/business.json";
import { createEngine } from "./engine.js";
import { DEFAULT_LANG } from "./i18n.js";
import { tierRanges, WHOLESALE_LIMIT } from "./pricing.js";

var L = createEngine(business);
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var e = L.esc;

/** Items revealed per "Load more" click (5 rows of 2). Kept small because
    item photos are large files. */
var PAGE = 10;

/* Local page state — deliberately not in the hash. Reset on navigation. */
var view = { q: "", sort: "", shown: PAGE };
var maker = { categoryId: null };

/** Image box. With a photo URL (business.json item "photo") it shows the
    image, lazy-loaded; the "Image" label underneath shows through if there is
    no photo or the file fails to load. */
function ph(cls, src, alt) {
  var img = src
    ? '<img src="' + e(src) + '" alt="' + e(alt || "") + '" loading="lazy" decoding="async" onerror="this.remove()">'
    : "";
  return '<div class="ph ' + (cls || "") + (src ? " ph--img" : "") + '"><span>' + e(L.t("image")) + "</span>" + img + "</div>";
}

/** Quantity stepper. Nothing chosen = an EMPTY input showing a "0"
    placeholder (not a real 0), so the customer can type straight away. */
function step(id) {
  var q = L.qtyOf(id);
  return '<div class="step' + (q ? " on" : "") + '" data-step="' + e(id) + '">' +
    '<button type="button" data-d="-1"' + (q === 0 ? " disabled" : "") + ' aria-label="-">−</button>' +
    '<input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="' + (q || "") + '" placeholder="0" aria-label="' + e(L.t("qty")) + '">' +
    '<button type="button" data-d="1" aria-label="+">+</button></div>';
}

/** Current per-pin price for display: the rate the whole cart is at now. */
function unitNow() {
  var t = L.totals();
  return t.wholesale ? L.t("wholesale") : L.usd(t.unitUsd) + " " + L.t("each");
}

function catTile(c) {
  return '<a class="tile tile--cat" href="#/' + e(c.id) + '"><div class="tile--cat__txt"><h3>' + e(L.nameOf(c)) +
    '</h3><div class="sub"><b>' + e(L.countLabel(c)) + "</b>" +
    (L.isCustom(c) || L.isGroup(c) ? ' · <span class="cus">' + e(L.t("createOwn")) + "</span>" : "") + "</div></div>" +
    '<span class="tile--cat__go" aria-hidden="true">›</span></a>';
}

function prodTile(p, withCat) {
  return '<article class="tile pt" data-p="' + e(p.id) + '">' + ph("ph--1", p.photo, L.nameOf(p)) +
    '<div class="pt__body"><h3>' + e(L.nameOf(p)) + "</h3>" +
    (withCat ? '<p class="where">' + e(L.nameOf(L.categoryOf(p))) + "</p>" : "") +
    '<p class="price">' + e(unitNow()) + "</p>" + step(p.id) + "</div></article>";
}

/** The action tile at the end of a custom category's grid. */
function makeTile(c) {
  return '<button type="button" class="tile pt tile--make" data-make="' + e(c.id) + '">' +
    '<div class="ph ph--1 ph--make"><span class="plus">+</span></div>' +
    '<div class="pt__body"><h3>' + e(L.t("createOwn")) + "</h3><p>" + e(L.t("createOwnHint")) + "</p></div></button>";
}

/* --------------------------------------------------------------- views */
function catSections() {
  var h = "";
  [["normal", "readyMade"], ["custom", "customRail"]].forEach(function (g) {
    var cats = L.byType(g[0]);
    if (!cats.length) return;
    h += '<div class="title"><h2>' + e(L.t(g[1])) + "</h2><span>" + cats.length + " " + e(L.t("statCats")) + "</span></div>" +
      '<div class="tiles tiles--cat">' + cats.map(catTile).join("") + "</div>";
  });
  return h;
}

function vHome() {
  return '<div id="categories-top">' + catSections() + "</div>" + infos();
}

function vCategories() {
  return '<div class="title"><h1>' + e(L.t("categories")) + "</h1><span>" + L.totalsInfo.products + " " +
    e(L.t("products")) + "</span></div>" + catSections();
}

function infos() {
  var wa = L.brand.whatsapp;
  return '<div class="infos">' +
    '<div class="card"><h2>' + e(L.t("deliveryInfo")) + "</h2><p>" + e(L.t("deliveryBody")) + "</p>" +
      '<button class="btn btn--o" data-open="rules" style="margin-top:14px">' + e(L.t("bulkRules")) + "</button></div>" +
    '<div class="card"><h2>' + e(L.t("contact")) + "</h2><dl><dt>WhatsApp</dt><dd>" +
      '<a class="lnk" href="https://wa.me/' + e(String(wa).replace(/\D/g, "")) + '" target="_blank" rel="noopener" dir="ltr">' +
      e(wa) + "</a></dd></dl></div></div>";
}

/** Location: city tiles only, 2 per row — pure navigation, no products. */
function vGroup(g) {
  return '<div class="title"><h1>' + e(L.nameOf(g)) + "</h1><span>" + e(L.countLabel(g)) + "</span></div>" +
    '<div class="tiles tiles--cat tiles--two">' + L.children(g).map(catTile).join("") + "</div>";
}

function vNode(id) {
  var c = L.node(id);
  if (!c) return vHome();
  if (L.isGroup(c)) return vGroup(c);
  var all = L.sortProducts(L.filterProducts(L.productsIn(c), view.q), view.sort);
  /* In custom categories/cities the "Create your own" card takes one of the
     page's slots, so each page is 9 items + the card = 10 cards (5 full rows). */
  var custom = L.isCustom(c);
  var shown = all.slice(0, custom ? view.shown - 1 : view.shown);
  var exhausted = shown.length >= all.length;
  var total = L.productsIn(c).length;

  var tools = "";
  if (total > 12) {
    tools = '<div class="tools">' +
      '<input type="search" id="fq" placeholder="' + e(L.t("filter")) + '" value="' + e(view.q) + '">' +
      '<select id="fs">' + L.SORTS.map(function (s) {
        return '<option value="' + s + '"' + (s === view.sort ? " selected" : "") + ">" + e(L.sortLabel(s)) + "</option>";
      }).join("") + "</select>" +
      '<span class="n">' + all.length + " " + e(L.t("of")) + " " + total + "</span></div>";
  }

  /* The "Create your own" card is always the last card of what is currently
     shown (the 10th, 20th, … slot), so it is reachable without loading every
     page; each "Load more" moves it to the end of the new batch. */
  var cells = shown.map(function (p) { return prodTile(p); }).join("") +
    (custom ? makeTile(c) : "");

  var body = cells
    ? '<div class="tiles tiles--prod">' + cells + "</div>"
    : '<div class="void"><h3>' + e(L.t("noResults")) + '</h3><button class="btn btn--o" data-clear>' + e(L.t("clear")) + "</button></div>";

  var more = exhausted ? "" :
    '<div class="more"><span>' + e(L.tf("showing", { n: shown.length, total: all.length })) + "</span>" +
    '<button class="btn btn--o" id="more" data-more>' + e(L.t("loadMore")) + "</button></div>";

  return '<div class="title"><h1>' + e(L.nameOf(c)) + "</h1><span>" + e(L.countLabel(c)) + "</span></div>" +
    tools + body + more;
}

function vSearch(q) {
  var r = L.search(q);
  var h = '<div class="title"><h1>' + e(L.t("searchResults")) + '</h1><span>"' + e(q) + '"</span></div>';
  if (!r.nodes.length && !r.products.length) {
    return h + '<div class="void"><h3>' + e(L.t("noResults")) + '</h3><button class="btn" data-go="">' + e(L.t("browse")) + "</button></div>";
  }
  if (r.nodes.length) h += '<div class="tiles tiles--cat" style="margin-bottom:14px">' + r.nodes.map(catTile).join("") + "</div>";
  if (r.products.length) h += '<div class="tiles tiles--prod">' +
    r.products.slice(0, 60).map(function (p) { return prodTile(p, true); }).join("") + "</div>";
  return h;
}

/** Shown in place of the price totals for a wholesale order (more than
    WHOLESALE_LIMIT catalogue pins). Checkout stays available. */
function wholesaleBox() {
  return '<div class="block"><h3>' + e(L.t("wholesaleTitle")) + "</h3><p>" +
    e(L.tf("wholesaleBody", { n: WHOLESALE_LIMIT })) + "</p></div>";
}

function tierHint(t) {
  var n = t.next;
  if (!n || !t.tier) return "";
  var cheaper = n.unitUsd < t.unitUsd;
  var freer = n.deliveryUsd === 0 && t.deliveryUsd > 0;
  var key = cheaper && freer ? "nextTierBoth" : cheaper ? "nextTier" : freer ? "nextTierFree" : "";
  return key ? '<div class="railtxt">' + e(L.tf(key, { n: n.need, price: L.usd(n.unitUsd) })) + "</div>" : "";
}

function sums() {
  var t = L.totals();
  if (t.wholesale) return wholesaleBox();
  return '<div class="sum"><span>' + t.count + " × " + e(L.usd(t.unitUsd)) + "</span><b>" + e(L.usd(t.subtotalUsd)) + "</b></div>" +
    '<div class="sum"><span>' + e(L.t("delivery")) + "</span><b" + (t.deliveryUsd === 0 ? ' class="good"' : "") + ">" +
      (t.deliveryUsd === 0 ? e(L.t("free")) : e(L.usd(t.deliveryUsd))) + "</b></div>" +
    '<div class="sum tot"><span>' + e(L.t("total")) + "</span><b>" + e(L.usd(t.totalUsd)) + "</b></div>" +
    tierHint(t) +
    '<button class="mini mini--link" data-open="rules">' + e(L.t("bulkRules")) + "</button>";
}

function cartList() {
  var ls = L.lines();
  if (!ls.length) return '<div class="void"><h3>' + e(L.t("emptyCart")) + "</h3><p>" + e(L.t("emptyCartHint")) +
    '</p><button class="btn" data-go="">' + e(L.t("browse")) + "</button></div>";
  return ls.map(function (l) {
    return '<div class="cl' + (l.kind === "custom" ? " cl--custom" : "") + '">' +
      (l.kind === "custom" ? '<div class="ph ph--xs ph--make"><span class="plus">✎</span></div>' : ph("ph--xs", l.product.photo, l.label)) +
      "<div><h4>" + e(l.label) + '</h4><div class="w">' + e(l.where) + "</div>" +
      '<div class="r">' + step(l.id) + '<span class="amt">' + (l.lineUsd == null ? "—" : e(L.usd(l.lineUsd))) + "</span></div>" +
      '<button class="mini" data-rm="' + e(l.id) + '">' + e(L.t("remove")) + "</button></div></div>";
  }).join("");
}

function vCart() {
  var n = L.count();
  return '<div class="title"><h1>' + e(L.t("cart")) + "</h1><span>" + n + " " + e(L.t(n === 1 ? "item" : "items")) + "</span></div>" +
    '<div class="pair"><div class="card">' + cartList() + "</div>" +
    (n ? '<div class="card">' + sums() +
      '<button class="btn btn--w" data-go="checkout" style="margin-top:12px">' + e(L.t("checkout")) + "</button>" +
      '<button class="btn btn--o btn--w" data-go="" style="margin-top:8px">' + e(L.t("continue")) + "</button></div>" : "") +
    "</div>";
}

function vCheckout() {
  if (!L.count()) return vCart();
  var right =
    '<div class="card ok"><h2>' + e(L.t("reviewTitle")) + "</h2><p>" + e(L.t("reviewBody")) + "</p>" +
    '<a class="wa" id="sendWa" href="' + e(L.whatsappUrl()) + '" target="_blank" rel="noopener">' + e(L.t("sendWhatsapp")) + "</a>" +
    '<div class="slip__lab">' + e(L.t("message")) + '</div><pre class="slip" id="slip" dir="ltr">' + e(L.orderText()) + "</pre>" +
    '<div class="row"><button class="btn btn--o" data-go="cart">' + e(L.t("backToCart")) + "</button>" +
    '<button class="btn btn--o" data-new>' + e(L.t("newOrder")) + "</button></div></div>";
  return '<div class="title"><h1>' + e(L.t("checkout")) + "</h1></div>" +
    '<div class="pair">' + right + '<div class="card"><h2>' + e(L.t("orderSummary")) + "</h2>" + cartList() +
    '<div style="margin-top:12px">' + sums() + "</div></div></div>";
}

/* -------------------------------------------------------------- popups */
function rulesTable() {
  var rows = tierRanges(L.tiers).map(function (t) {
    return "<tr><td>" + (t.from === t.to ? t.from : t.from + "–" + t.to) + "</td><td>" + e(L.usd(t.unitUsd)) + "</td><td>" +
      (t.deliveryUsd === 0 ? '<b class="good">' + e(L.t("free")) + "</b>" : e(L.usd(t.deliveryUsd))) + "</td></tr>";
  }).join("");
  rows += '<tr class="over"><td>' + (WHOLESALE_LIMIT + 1) + '+</td><td colspan="2">' + e(L.t("bulkOver")) + "</td></tr>";
  return "<p>" + e(L.t("bulkIntro")) + "</p>" +
    '<table class="rules"><thead><tr><th>' + e(L.t("colPins")) + "</th><th>" + e(L.t("colUnit")) + "</th><th>" +
    e(L.t("colDelivery")) + "</th></tr></thead><tbody>" + rows + "</tbody></table>" +
    '<p class="note">' + e(L.t("bulkNote")) + "</p>";
}

function fillMaker() {
  var c = L.node(maker.categoryId);
  if (!c) return;
  $("#makerTitle").textContent = L.nameOf(c);
  var mine = L.customsIn(c.id);
  $("#makerList").innerHTML = mine.length
    ? '<div class="mk__lab">' + e(L.t("inYourCart")) + "</div>" + mine.map(function (m) {
        return '<div class="mk__row"><span>' + e(m.text) + "</span><b>× " + m.qty + "</b></div>";
      }).join("")
    : "";
}

function openMaker(id) {
  maker.categoryId = id;
  var f = $("#makerForm");
  f.reset();
  clearErrors(f);
  fillMaker();
  $("#maker").hidden = false;
  $("#mkText").focus();
}

function clearErrors(f) {
  $$("em[data-err]", f).forEach(function (x) { x.textContent = ""; });
  $$(".fl", f).forEach(function (x) { x.classList.remove("bad"); });
}

/* -------------------------------------------------------------- chrome */
function rail(el, cats, labelKey, withAll, active) {
  var chips = (withAll ? [{ id: "", label: L.t("allCategories") }] : [])
    .concat(cats.map(function (c) { return { id: c.id, label: L.nameOf(c) }; }));
  el.hidden = !cats.length;
  el.innerHTML = '<span class="chiprail__lab">' + e(L.t(labelKey)) + "</span>" + chips.map(function (c) {
    var on = active != null && (active === c.id || (c.id && active.indexOf(c.id + "/") === 0));
    return '<button data-go="' + e(c.id) + '"' + (on ? ' class="on"' : "") + ">" + e(c.label) + "</button>";
  }).join("");
}

function chrome(r) {
  $$("[data-t]").forEach(function (el) { el.textContent = L.t(el.getAttribute("data-t")); });
  $$("[data-t-ph]").forEach(function (el) { el.placeholder = L.t(el.getAttribute("data-t-ph")); });
  $$("[data-brand]").forEach(function (el) { el.textContent = L.field(L.brand, el.getAttribute("data-brand")); });
  $("#langBtn").textContent = L.t("lang");
  paintThemeBtn();
  $("#cartN").textContent = L.count();
  $("#clearQ").hidden = !$("#q").value;
  $("#hero").hidden = r.view !== "home";

  var active = r.view === "node" ? r.path : r.view === "home" ? "" : null;
  rail($("#railNormal"), L.byType("normal"), "readyMade", true, active);
  rail($("#railCustom"), L.byType("custom"), "customRail", false, active);

  var cs = L.breadcrumb(r.path);
  $("#crumbline").innerHTML = r.view === "node"
    ? cs.map(function (c, i) {
        var last = i === cs.length - 1;
        return (i ? "<span>/</span>" : "") + (last ? "<b>" + e(c.label) + "</b>" : '<a href="#/' + e(c.path) + '">' + e(c.label) + "</a>");
      }).join("")
    : "";
  $("#crumbline").hidden = r.view !== "node";

  $("#base").innerHTML = footer();

  var tabs = [
    { go: "", g: "◈", label: L.t("home"), on: r.view === "home" },
    { go: "categories", g: "▦", label: L.t("categories"), on: r.view === "node" || r.view === "categories" },
    { act: "search", g: "⌕", label: L.t("search"), on: r.view === "search" },
    { act: "cart", g: "▮", label: L.t("cart") + " " + L.count(), on: r.view === "cart" || r.view === "checkout" }
  ];
  $("#tabs").innerHTML = tabs.map(function (b) {
    return "<button " + (b.go != null ? 'data-go="' + e(b.go) + '"' : 'data-act="' + b.act + '"') +
      (b.on ? ' class="on"' : "") + '><span class="g">' + b.g + "</span><span>" + e(b.label) + "</span></button>";
  }).join("");

  $("#rulesBody").innerHTML = rulesTable();
  if (!$("#maker").hidden) fillMaker();
}

/* ------------------------------------------------------------ theme */
/* Dark (PULSE) by default; light uses the TILE palette. The choice is kept
   in localStorage so it survives reloads; the inline script in index.astro
   applies it before first paint. */
function theme() { return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"; }
function setTheme(next) {
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch (x) { /* private mode etc. */ }
  paintThemeBtn();
}
function paintThemeBtn() {
  var light = theme() === "light";
  var b = $("#themeBtn");
  b.querySelector(".i-sun").style.display = light ? "none" : "";
  b.querySelector(".i-moon").style.display = light ? "" : "none";
  b.setAttribute("aria-label", L.t(light ? "toDark" : "toLight"));
  b.title = L.t(light ? "toDark" : "toLight");
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", light ? "#f4f6fa" : "#05070b");
}

/* ----------------------------------------------------------- footer */
var ICON_PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7m0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5"/></svg>';

/** Footer: brand, location (brand.location_name_* + location_link) and the
    phone number, all from business.json. WhatsApp itself is the floating
    button (#waFab) in index.astro. */
function footer() {
  var b = L.brand;
  var tel = String(b.whatsapp || "").replace(/[^\d+]/g, "");
  var place = L.field(b, "location_name");
  var loc = place
    ? '<div class="foot__col"><h4>' + e(L.t("footVisit")) + "</h4>" +
      '<a class="foot__loc" href="' + e(b.location_link || "#") + '" target="_blank" rel="noopener">' +
      '<span class="foot__ico">' + ICON_PIN + "</span><span>" + e(place) + "</span></a>" +
      (b.location_link ? '<a class="foot__more" href="' + e(b.location_link) + '" target="_blank" rel="noopener">' +
        e(L.t("footOpenMaps")) + " ↗</a>" : "") + "</div>"
    : "";
  return '<div class="foot">' +
    '<div class="foot__brand"><div class="foot__logo"><span class="glowdot"></span><b>' + e(b.name) + "</b></div>" +
      "<p>" + e(L.field(b, "tagline")) + "</p>" +
      "</div>" +
    loc +
    '<div class="foot__col"><h4>' + e(L.t("contact")) + "</h4><p>" + e(L.t("footChatHint")) + "</p>" +
      '<a class="foot__num" href="tel:' + e(tel) + '" dir="ltr">' + e(b.whatsapp) + "</a></div>" +
    "</div>" +
    '<div class="foot__bar">© ' + new Date().getFullYear() + " " + e(b.name) + ". " + e(L.t("footRights")) + "</div>";
}

/* Re-rendering replaces #main, so remember which input had focus (a stepper
   or the filter box) and put the caret back where it was afterwards. */
function focusKey() {
  var el = document.activeElement;
  if (!el || el.tagName !== "INPUT") return null;
  var scope = el.closest("#main") ? "#main" : el.closest("#sheet") ? "#sheet" : null;
  if (!scope) return null;
  var s = el.closest("[data-step]");
  var sel = el.id ? "#" + el.id
    : s ? scope + ' [data-step="' + CSS.escape(s.getAttribute("data-step")) + '"] input' : null;
  return sel ? { sel: sel, at: el.selectionStart } : null;
}

function render() {
  var r = L.parseHash();
  var fk = focusKey();
  chrome(r);
  $("#main").innerHTML =
    r.view === "node" ? vNode(r.path) :
    r.view === "categories" ? vCategories() :
    r.view === "search" ? vSearch(r.q) :
    r.view === "cart" ? vCart() :
    r.view === "checkout" ? vCheckout() : vHome();
  if (!$("#sheet").hidden) fillSheet();
  if (fk) {
    var el = $(fk.sel);
    if (el) {
      el.focus();
      var at = Math.min(fk.at == null ? el.value.length : fk.at, el.value.length);
      el.setSelectionRange(at, at);
    }
  }
}

function fillSheet() {
  var n = L.count();
  $("#sheetBody").innerHTML = cartList();
  $("#sheetFoot").innerHTML = n
    ? sums() + '<button class="btn btn--w" data-go="checkout" style="margin-top:12px">' + e(L.t("checkout")) + "</button>"
    : "";
  $("#sheetFoot").hidden = !n;
}

/* -------------------------------------------------------------- events */
var bt;
function beep(m) {
  var el = $("#beep");
  el.textContent = m; el.classList.add("on");
  clearTimeout(bt); bt = setTimeout(function () { el.classList.remove("on"); }, 2200);
}
function closeAll() { $$(".sheet, .modal").forEach(function (m) { m.hidden = true; }); }

document.addEventListener("click", function (ev) {
  var go = ev.target.closest("[data-go]");
  if (go) {
    ev.preventDefault(); closeAll();
    var dest = go.getAttribute("data-go");
    /* same hash → no hashchange event, so re-render by hand */
    if (location.hash === "#/" + dest) { render(); window.scrollTo(0, 0); } else L.goTo(dest);
    return;
  }

  var act = ev.target.closest("[data-act]");
  if (act) {
    var a = act.getAttribute("data-act");
    if (a === "search") { $("#q").focus(); window.scrollTo(0, 0); }
    if (a === "cart") { $("#sheet").hidden = false; fillSheet(); }
    return;
  }
  var op = ev.target.closest("[data-open]");
  if (op) { $("#" + op.getAttribute("data-open")).hidden = false; return; }
  if (ev.target.closest("#cartBtn")) { $("#sheet").hidden = false; fillSheet(); return; }
  var cl = ev.target.closest("[data-close]");
  if (cl) { cl.closest(".sheet, .modal").hidden = true; return; }
  if (ev.target.closest("#langBtn")) { L.toggleLang(); return; }
  if (ev.target.closest("#themeBtn")) { setTheme(theme() === "light" ? "dark" : "light"); return; }
  if (ev.target.closest("#clearQ")) { $("#q").value = ""; L.goTo(""); return; }

  var mk = ev.target.closest("[data-make]");
  if (mk) { openMaker(mk.getAttribute("data-make")); return; }

  /* stepper inside the "Create your own" popup: empty ↔ 1…n */
  var mkd = ev.target.closest("[data-mk]");
  if (mkd) {
    var qi = $("#mkQty");
    var next = (parseInt(qi.value, 10) || 0) + Number(mkd.getAttribute("data-mk"));
    qi.value = next < 1 ? "" : String(next);
    return;
  }

  var sb = ev.target.closest("[data-step] button");
  if (sb) { L.bump(sb.closest("[data-step]").getAttribute("data-step"), Number(sb.getAttribute("data-d"))); return; }

  var rm = ev.target.closest("[data-rm]");
  if (rm) { L.remove(rm.getAttribute("data-rm")); return; }
  if (ev.target.closest("[data-more]")) { view.shown += PAGE; render(); return; }
  if (ev.target.closest("[data-clear]")) { view.q = ""; view.shown = PAGE; render(); return; }
  if (ev.target.closest("[data-new]")) { L.clearCart(); L.goTo(""); return; }

  /* Rebuild the message at the moment of sending so DATE/TIME are current. */
  var wa = ev.target.closest("#sendWa");
  if (wa) {
    var now = new Date();
    wa.href = L.whatsappUrl(now);
    var slip = $("#slip");
    if (slip) slip.textContent = L.orderText(now);
  }
});

document.addEventListener("input", function (ev) {
  if (ev.target.id === "q") {
    var v = ev.target.value.trim();
    $("#clearQ").hidden = !v;
    clearTimeout(ev.target._t);
    ev.target._t = setTimeout(function () { v ? L.goTo("search=" + encodeURIComponent(v)) : L.goTo(""); }, 220);
  }
  if (ev.target.id === "fq") {
    view.q = ev.target.value;
    clearTimeout(ev.target._t);
    ev.target._t = setTimeout(function () { view.shown = PAGE; render(); }, 200);
  }
  /* Stepper typed input: digits only, applied live. An empty field means
     "not chosen", exactly like 0. On an item tile that is applied at once
     (the field shows its "0" placeholder); on a cart line it is applied when
     the field is left, so backspacing to retype a quantity does not make the
     line — or a typed custom name — disappear mid-edit. */
  var st = ev.target.tagName === "INPUT" && ev.target.closest("[data-step]");
  if (st) {
    var digits = ev.target.value.replace(/\D/g, "");
    if (digits !== ev.target.value) ev.target.value = digits;
    if (digits !== "") L.setQty(st.getAttribute("data-step"), digits);
    else if (!st.closest(".cl")) L.setQty(st.getAttribute("data-step"), 0);
  }
});

document.addEventListener("change", function (ev) {
  if (ev.target.id === "fs") { view.sort = ev.target.value; view.shown = PAGE; render(); }
  /* left a stepper empty → "not chosen", same as 0 */
  var es = ev.target.value === "" && ev.target.closest("[data-step]");
  if (es) L.setQty(es.getAttribute("data-step"), 0);
});

/* "Create your own" → Add to cart. Stays open and clears both fields so the
   next custom pin can be typed straight away. */
document.addEventListener("submit", function (ev) {
  if (ev.target.id !== "makerForm") return;
  ev.preventDefault();
  var f = ev.target;
  var text = f.elements.text.value.trim();
  var qty = parseInt(f.elements.qty.value, 10);
  var errs = {};
  if (!text) errs.text = L.t("needText");
  if (!(qty >= 1)) errs.qty = L.t("needQty");
  clearErrors(f);
  if (Object.keys(errs).length) {
    Object.keys(errs).forEach(function (k) {
      var em = $('[data-err="' + k + '"]', f);
      em.textContent = errs[k];
      em.closest(".fl").classList.add("bad");
    });
    return;
  }
  var entry = L.addCustom(maker.categoryId, text, qty);
  if (!entry) return;
  f.elements.text.value = "";
  f.elements.qty.value = "";
  beep(L.t("addedToCart") + ": " + entry.text + " × " + qty);
  f.elements.text.focus();
});

document.addEventListener("keydown", function (ev) {
  if (ev.key === "Escape") closeAll();
  if (ev.key === "/" && ["INPUT", "TEXTAREA", "SELECT"].indexOf(document.activeElement.tagName) === -1) {
    ev.preventDefault(); $("#q").focus();
  }
});

window.addEventListener("hashchange", function () {
  view.q = ""; view.sort = ""; view.shown = PAGE;
  render(); window.scrollTo(0, 0);
});
L.onChange(render);
L.setLang(DEFAULT_LANG);
