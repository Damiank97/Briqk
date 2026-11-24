(function () {
  "use strict";

  var measurementId = "G-1H8P518FLC";
  var storageKey = "briqkAnalyticsConsent";
  var loaded = false;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    wait_for_update: 500
  });

  function getChoice() {
    try { return localStorage.getItem(storageKey); } catch (error) { return null; }
  }

  function updateConsent(value) {
    var granted = value === "granted";
    window.gtag("consent", "update", {
      analytics_storage: granted ? "granted" : "denied",
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied"
    });
  }

  function load() {
    if (loaded || window.__briqkAnalyticsLoaded) return;
    loaded = true;
    window.__briqkAnalyticsLoaded = true;
    updateConsent("granted");
    window.gtag("js", new Date());
    window.gtag("config", measurementId, { anonymize_ip: true });
    var script = document.createElement("script");
    script.async = true;
    script.src = "https://www.googletagmanager.com/gtag/js?id=" + measurementId;
    document.head.appendChild(script);
  }

  function setChoice(value) {
    try { localStorage.setItem(storageKey, value); } catch (error) { /* Browseropslag kan geblokkeerd zijn. */ }
    updateConsent(value);
    var banner = document.getElementById("privacyBanner");
    if (banner) banner.hidden = true;
    if (value === "granted") load();
  }

  function track(name, parameters) {
    if (getChoice() !== "granted") return;
    load();
    window.gtag("event", name, parameters || {});
  }

  function normaliseOffer(value) {
    var text = String(value || "").toLowerCase().replace(/[_-]+/g, " ");
    if (text.indexOf("website review") !== -1) return "website_review";
    if (text.indexOf("product review") !== -1 || text.indexOf("applicatie") !== -1) return "product_review";
    if (text.indexOf("ai advies") !== -1 || text.indexOf("ai verkenning") !== -1 || text.indexOf("ai kansenanalyse") !== -1 || text.indexOf("ai implementatie") !== -1) return "ai_advies";
    if (text.indexOf("website") !== -1 || text.indexOf("merk") !== -1) return "website";
    if (text.indexOf("automatis") !== -1 || text.indexOf("maatwerk") !== -1 || text.indexOf("portaal") !== -1) return "automatisering";
    return "anders";
  }

  function selectedOffer(form) {
    if (form.dataset.offer) return normaliseOffer(form.dataset.offer);
    var checked = form.querySelector('input[name="interesse"]:checked');
    return normaliseOffer(checked ? checked.value : "");
  }

  function prepareFormRedirect(form) {
    var next = form.querySelector('input[name="_next"]');
    if (!next) return;
    var type = form.querySelector('[name="bedrijfstype"], [name="company_type"]');
    var url = new URL("https://www.briqk.nl/bedankt");
    url.searchParams.set("offer", selectedOffer(form));
    url.searchParams.set("form_location", window.location.pathname);
    if (type && type.value) url.searchParams.set("company_type", type.value.slice(0, 80));
    next.value = url.toString();
  }

  function initialise() {
    var choice = getChoice();
    var banner = document.getElementById("privacyBanner");
    if (choice === "granted") load();
    if (banner && choice !== "granted" && choice !== "denied") banner.hidden = false;
    var accept = document.getElementById("analyticsAccept");
    var decline = document.getElementById("analyticsDecline");
    if (accept) accept.addEventListener("click", function () { setChoice("granted"); });
    if (decline) decline.addEventListener("click", function () { setChoice("denied"); });

    document.querySelectorAll("form[data-track-form]").forEach(function (form) {
      form.addEventListener("submit", function () { prepareFormRedirect(form); });
    });

    document.addEventListener("click", function (event) {
      var email = event.target.closest('a[href^="mailto:info@briqk.nl"]');
      if (email) track("contact_email_click", { location: window.location.pathname });
      var cta = event.target.closest("[data-cta-offer]");
      if (!cta) {
        var possibleCta = event.target.closest("a,button");
        if (possibleCta && /plan een/i.test(possibleCta.textContent)) cta = possibleCta;
      }
      if (cta) {
        var source = cta.getAttribute("data-cta-offer") || cta.textContent || window.location.pathname;
        if (normaliseOffer(source) === "anders" && /website-laten-maken|ai-website/.test(window.location.pathname)) source = "website";
        if (normaliseOffer(source) === "anders" && /automatisering|whatsapp/.test(window.location.pathname)) source = "automatisering";
        if (normaliseOffer(source) === "anders" && /ai-advies/.test(window.location.pathname)) source = "ai_advies";
        track("cta_click", {
          offer: normaliseOffer(source),
          location: cta.getAttribute("data-cta-location") || window.location.pathname
        });
      }
    });

    if (document.body.dataset.thankYou === "true") {
      var params = new URLSearchParams(window.location.search);
      var onceKey = "briqkLead:" + window.location.search;
      var alreadySent = false;
      try { alreadySent = sessionStorage.getItem(onceKey) === "1"; } catch (error) { /* Geen sessieopslag. */ }
      if (!alreadySent) {
        track("generate_lead", {
          form_location: (params.get("form_location") || (document.referrer ? new URL(document.referrer).pathname : "onbekend")).slice(0, 120),
          offer: normaliseOffer(params.get("offer")),
          company_type: (params.get("company_type") || "onbekend").slice(0, 80)
        });
        try { sessionStorage.setItem(onceKey, "1"); } catch (error) { /* Geen sessieopslag. */ }
      }
    }
  }

  window.BriqkAnalytics = { track: track, setChoice: setChoice, getChoice: getChoice, normaliseOffer: normaliseOffer };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialise);
  else initialise();
})();
