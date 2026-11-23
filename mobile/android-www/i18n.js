"use strict";

(() => {
  const STORAGE_KEY = "workbuddy-desktop-locale";
  const CODES = ["zh-Hans", "zh-Hant", "en", "ja", "ko", "pt-BR"];
  const LOCALES = [{
    code: "zh-Hans",
    label: "\u7B80\u4F53\u4E2D\u6587",
    nameKey: "\u7B80\u4F53\u4E2D\u6587"
  }, {
    code: "zh-Hant",
    label: "\u7E41\u9AD4\u4E2D\u6587",
    nameKey: "\u7E41\u4F53\u4E2D\u6587"
  }, {
    code: "en",
    label: "English",
    nameKey: "\u82F1\u8BED"
  }, {
    code: "ja",
    label: "\u65E5\u672C\u8A9E",
    nameKey: "\u65E5\u8BED"
  }, {
    code: "ko",
    label: "\uD55C\uAD6D\uC5B4",
    nameKey: "\u97E9\u8BED"
  }, {
    code: "pt-BR",
    label: "Portugu\xEAs (Brasil)",
    nameKey: "\u5DF4\u897F\u8461\u8404\u7259\u8BED"
  }];
  const ATTR_TARGETS = {
    "data-i18n-title": "title",
    "data-i18n-placeholder": "placeholder",
    "data-i18n-tip": "data-tip",
    "data-i18n-aria-label": "aria-label"
  };
  function t(key, params) {
    const value = (window.wbI18nDict || {})[key];
    let text = typeof value === "string" && value ? value : key;
    if (params) {
      text = text.replace(/\{(\w+)\}/g, (_match, name) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : "");
    }
    return text;
  }
  function resolveLocale(raw) {
    if (raw && raw !== "auto" && CODES.indexOf(raw) >= 0) return raw;
    const tags = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (const rawTag of tags) {
      const tag = String(rawTag || "").toLowerCase();
      if (!tag) continue;
      if (tag === "zh-tw" || tag === "zh-hk" || tag === "zh-mo" || tag.indexOf("hant") >= 0) return "zh-Hant";
      if (tag.indexOf("zh") === 0) return "zh-Hans";
      if (tag.indexOf("ja") === 0) return "ja";
      if (tag.indexOf("ko") === 0) return "ko";
      if (tag.indexOf("pt") === 0) return "pt-BR";
    }
    return "en";
  }
  function rawLocale() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value || "auto";
    } catch (e) {
      return "auto";
    }
  }
  function locale() {
    return resolveLocale(rawLocale());
  }
  function setLocale(value) {
    const next = value === "auto" || CODES.indexOf(value) >= 0 ? value : "auto";
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (e) {}
    location.reload();
  }
  function sweep(root) {
    const scope = root || document;
    for (const el of scope.querySelectorAll("[data-i18n]")) {
      const key = el.dataset.i18n || (el.textContent || "").trim();
      if (key) el.textContent = t(key);
    }
    for (const [attr, target] of Object.entries(ATTR_TARGETS)) {
      for (const el of scope.querySelectorAll("[" + attr + "]")) {
        const key = el.getAttribute(attr);
        if (key) el.setAttribute(target, t(key));
      }
    }
  }
  const current = locale();
  document.documentElement.lang = current;
  if (!window.__WB_I18N_INJECTED && current !== "zh-Hans" && document.readyState === "loading") {
    const domains = window.__WB_I18N_DOMAINS || [];
    for (const domain of domains) {
      document.write('<script src="i18n/' + current + "/" + domain + '.js"><\/script>');
    }
  }
  window.wbI18n = {
    t,
    locale,
    rawLocale,
    setLocale,
    sweep,
    LOCALES
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => sweep(), {
      once: true
    });
  } else {
    sweep();
  }
})();