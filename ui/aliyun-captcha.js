"use strict";

var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, {
  enumerable: true,
  configurable: true,
  writable: true,
  value
}) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {})) if (__hasOwnProp.call(b, prop)) __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols) for (var prop of __getOwnPropSymbols(b)) {
    if (__propIsEnum.call(b, prop)) __defNormalProp(a, prop, b[prop]);
  }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = value => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = value => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = x => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};
(() => {
  const SDK_URL = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
  const SCRIPT_ID = "aliyun-captcha-sdk";
  const SCRIPT_TIMEOUT_MS = 4e4;
  const INIT_TIMEOUT_MS = 4e4;
  const VERIFY_TIMEOUT_MS = 12e4;
  const REQUEST_TIMEOUT_MS = 12e4;
  const WARMUP_MS = 2100;
  const t = (key, params) => {
    var _a, _b;
    return ((_b = (_a = window.wbI18n) == null ? void 0 : _a.t) == null ? void 0 : _b.call(_a, key, params)) || key;
  };
  class CaptchaError extends Error {
    constructor(message, details = {}) {
      super(message);
      this.name = "CaptchaError";
      this.code = details.code || "";
      this.requestId = details.requestId || "";
      this.upstreamMessage = details.upstreamMessage || "";
      this.retryAt = details.retryAt || 0;
    }
  }
  class CaptchaCancelledError extends CaptchaError {
    constructor() {
      super(t("\u5DF2\u53D6\u6D88\u9A8C\u8BC1\u7801"));
      this.name = "CaptchaCancelledError";
    }
  }
  let scriptPromise = null;
  let sdkKey = "";
  let active = null;
  let sequence = 0;
  let retryAt = 0;
  let cooldownError = null;
  function language() {
    const value = String(document.documentElement.lang || "zh-CN").replace(/_/g, "-").toLowerCase();
    if (value.startsWith("zh-hant") || value === "zh-tw") return "tw";
    if (value.startsWith("zh")) return "cn";
    const code = value.split("-")[0];
    if (code === "id") return "in";
    return ["ar", "de", "es", "fr", "in", "it", "ja", "ko", "pt", "ru", "th", "tr", "vi"].includes(code) ? code : "en";
  }
  function errorOf(value, fallback = t("\u9A8C\u8BC1\u7801\u6821\u9A8C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5")) {
    var _a, _b;
    if (value instanceof CaptchaError) return value;
    const source = value && typeof value === "object" ? value : {};
    const result = source.Result || source.result || {};
    const code = String(source.VerifyCode || source.verifyCode || result.VerifyCode || result.verifyCode || source.code || source.Code || (typeof value === "string" && /^F\d+$/.test(value) ? value : ""));
    const requestId = String(source.RequestId || source.requestId || "");
    const message = String(source.message || source.msg || source.Message || (typeof value === "string" && value !== code ? value : "") || fallback);
    let reason = message;
    if (code === "F010" || code === "F011") reason = t("\u9A8C\u8BC1\u8BF7\u6C42\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
    if (code === "F008") reason = t("\u9A8C\u8BC1\u7801\u5DF2\u4F7F\u7528\uFF0C\u8BF7\u91CD\u65B0\u9A8C\u8BC1");
    if (["F001", "F009", "F024", "F025"].includes(code)) reason = t("\u9A8C\u8BC1\u88AB\u4E0A\u6E38\u98CE\u63A7\u62D2\u7EDD\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5");
    const error = new CaptchaError([reason, code].filter(Boolean).join(" \xB7 "), {
      code,
      requestId,
      upstreamMessage: message
    });
    if (["F001", "F009", "F010", "F011", "F024", "F025"].includes(code)) {
      retryAt = Date.now() + 5 * 6e4;
      error.retryAt = retryAt;
      cooldownError = error;
    }
    const log = {
      code,
      requestId,
      message: reason
    };
    console.warn("[AliyunCaptcha]", log);
    (_b = (_a = window.wbApp) == null ? void 0 : _a.debug) == null ? void 0 : _b.call(_a, `[AliyunCaptcha] ${JSON.stringify(log)}`);
    return error;
  }
  function destroy(instance) {
    var _a, _b;
    try {
      (_a = instance == null ? void 0 : instance.hide) == null ? void 0 : _a.call(instance);
    } catch (e) {}
    try {
      if (typeof (instance == null ? void 0 : instance.destroyCaptcha) === "function") instance.destroyCaptcha();else (_b = instance == null ? void 0 : instance.destroy) == null ? void 0 : _b.call(instance);
    } catch (e) {}
  }
  function current(flow) {
    return active === flow && !flow.settled;
  }
  function requireCurrent(flow) {
    var _a;
    if (!current(flow) || ((_a = flow.signal) == null ? void 0 : _a.aborted)) throw new CaptchaCancelledError();
  }
  function settle(flow, value, error) {
    var _a, _b, _c, _d;
    if (!current(flow)) return false;
    flow.settled = true;
    active = null;
    window.clearTimeout(flow.timer);
    (_a = flow.signal) == null ? void 0 : _a.removeEventListener("abort", flow.onAbort);
    (_b = flow.cancelInit) == null ? void 0 : _b.call(flow);
    flow.cancelInit = null;
    destroy(flow.instance);
    (_c = document.getElementById(flow.elementId)) == null ? void 0 : _c.remove();
    (_d = document.getElementById(flow.buttonId)) == null ? void 0 : _d.remove();
    if (error) flow.reject(error);else flow.resolve(value);
    return true;
  }
  function onPhase(flow, phase) {
    var _a;
    try {
      (_a = flow.onPhase) == null ? void 0 : _a.call(flow, phase);
    } catch (e) {}
  }
  function armTimeout(flow, delay, message) {
    window.clearTimeout(flow.timer);
    flow.timer = window.setTimeout(() => settle(flow, null, new CaptchaError(message)), delay);
  }
  function loadSdk(config) {
    var _a;
    const key = `${config.region}:${config.prefix}`;
    window.AliyunCaptchaConfig = {
      region: config.region,
      prefix: config.prefix
    };
    if (sdkKey && sdkKey !== key) {
      (_a = document.getElementById(SCRIPT_ID)) == null ? void 0 : _a.remove();
      window.initAliyunCaptcha = void 0;
      scriptPromise = null;
    }
    sdkKey = key;
    if (typeof window.initAliyunCaptcha === "function") return Promise.resolve();
    if (scriptPromise) return scriptPromise;
    const promise = new Promise((resolve, reject) => {
      var _a2;
      (_a2 = document.getElementById(SCRIPT_ID)) == null ? void 0 : _a2.remove();
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SDK_URL;
      script.async = true;
      const timer = window.setTimeout(() => finish(new CaptchaError(t("\u9A8C\u8BC1\u7801\u7EC4\u4EF6\u52A0\u8F7D\u8D85\u65F6\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5"))), SCRIPT_TIMEOUT_MS);
      const finish = error => {
        window.clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (error) {
          script.remove();
          reject(error);
        } else resolve();
      };
      script.onload = () => finish(typeof window.initAliyunCaptcha === "function" ? null : new CaptchaError(t("\u9A8C\u8BC1\u7801\u7EC4\u4EF6\u52A0\u8F7D\u5F02\u5E38\uFF0C\u8BF7\u91CD\u8BD5")));
      script.onerror = () => finish(new CaptchaError(t("\u9A8C\u8BC1\u7801\u7EC4\u4EF6\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5\u7F51\u7EDC\u540E\u91CD\u8BD5")));
      document.head.appendChild(script);
    });
    scriptPromise = promise;
    promise.catch(() => {
      if (scriptPromise === promise) scriptPromise = null;
    });
    return promise;
  }
  function elements(flow) {
    const element = document.createElement("div");
    element.id = flow.elementId;
    element.style.position = "relative";
    element.style.zIndex = "2147483000";
    const button = document.createElement("button");
    button.id = flow.buttonId;
    button.type = "button";
    button.tabIndex = -1;
    button.setAttribute("aria-hidden", "true");
    Object.assign(button.style, {
      position: "fixed",
      width: "1px",
      height: "1px",
      opacity: "0",
      pointerEvents: "none"
    });
    document.body.append(element, button);
  }
  function submit(flow, param) {
    return __async(this, null, function* () {
      if (!current(flow) || flow.submitting) return null;
      if (typeof param !== "string" || !param.trim()) {
        settle(flow, null, new CaptchaError(t("\u9A8C\u8BC1\u7801\u7EC4\u4EF6\u8FD4\u56DE\u7684\u9A8C\u8BC1\u4E32\u4E0D\u5B8C\u6574\uFF08\u8BF7\u91CD\u8BD5\uFF09")));
        return null;
      }
      flow.submitting = true;
      onPhase(flow, "submitting");
      armTimeout(flow, REQUEST_TIMEOUT_MS, t("\u9A8C\u8BC1\u7801\u4E1A\u52A1\u8BF7\u6C42\u8D85\u65F6\uFF0C\u8BF7\u5237\u65B0\u72B6\u6001\u540E\u91CD\u8BD5"));
      try {
        const result = yield flow.request(param);
        if (current(flow)) {
          if (flow.protocol === "v2") window.setTimeout(() => settle(flow, result), 0);else settle(flow, result);
        }
        return result;
      } catch (error) {
        settle(flow, null, errorOf(error));
        return null;
      }
    });
  }
  function initialize(flow, config) {
    return __async(this, null, function* () {
      var _a, _b;
      yield loadSdk(config);
      requireCurrent(flow);
      elements(flow);
      yield new Promise((resolve, reject) => {
        let done = false;
        const timer = window.setTimeout(() => finish(new CaptchaError(t("\u9A8C\u8BC1\u7801\u7EC4\u4EF6\u521D\u59CB\u5316\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5"))), INIT_TIMEOUT_MS);
        const finish = error => {
          if (done) return;
          done = true;
          flow.cancelInit = null;
          window.clearTimeout(timer);
          if (error) reject(error);else resolve();
        };
        flow.cancelInit = () => finish(new CaptchaCancelledError());
        const fail = value => {
          if (!current(flow) || flow.submitting) return;
          const error = errorOf(value);
          finish(error);
          settle(flow, null, error);
        };
        const options = {
          SceneId: config.sceneId,
          mode: "popup",
          element: `#${flow.elementId}`,
          button: `#${flow.buttonId}`,
          language: language(),
          showErrorTip: true,
          zIndex: 2147483e3,
          getInstance: instance => {
            if (!current(flow) || done) {
              destroy(instance);
              finish(new CaptchaCancelledError());
              return;
            }
            flow.instance = instance;
            flow.initializedAt = Date.now();
            finish();
          },
          fail,
          onError: fail,
          onClose: reason => {
            if (reason === "userDismiss" && !flow.submitting) settle(flow, null, new CaptchaCancelledError());
          }
        };
        if (flow.protocol === "v2") {
          options.captchaVerifyCallback = param => __async(null, null, function* () {
            const result = yield submit(flow, param);
            return {
              captchaResult: Boolean(result == null ? void 0 : result.captchaResult),
              bizResult: Boolean(result == null ? void 0 : result.bizResult)
            };
          });
          options.onBizResultCallback = () => {};
        } else {
          options.success = value => {
            const param = typeof value === "string" ? value : (value == null ? void 0 : value.captchaVerifyParam) || (value == null ? void 0 : value.verifyParam);
            void submit(flow, param);
          };
        }
        try {
          window.initAliyunCaptcha(options);
        } catch (error) {
          fail(error);
        }
      });
      requireCurrent(flow);
      const remaining = WARMUP_MS - (Date.now() - flow.initializedAt);
      if (remaining > 0) yield new Promise(resolve => window.setTimeout(resolve, remaining));
      requireCurrent(flow);
      onPhase(flow, "verifying");
      armTimeout(flow, VERIFY_TIMEOUT_MS, t("\u9A8C\u8BC1\u7801\u6821\u9A8C\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5"));
      if (flow.protocol === "v3" && typeof ((_a = flow.instance) == null ? void 0 : _a.startTracelessVerification) === "function") flow.instance.startTracelessVerification();else if (typeof ((_b = flow.instance) == null ? void 0 : _b.show) === "function") flow.instance.show();else throw new CaptchaError(t("\u9A8C\u8BC1\u7801\u7EC4\u4EF6\u4E0D\u53EF\u7528\uFF0C\u8BF7\u91CD\u8BD5"));
    });
  }
  function solve(config, request, signal, options = {}) {
    if (signal == null ? void 0 : signal.aborted) return Promise.reject(new CaptchaCancelledError());
    if (active) return Promise.reject(new CaptchaError(t("\u5DF2\u6709\u9A8C\u8BC1\u7801\u6D41\u7A0B\u6B63\u5728\u8FDB\u884C\uFF0C\u8BF7\u5148\u5B8C\u6210\u6216\u53D6\u6D88")));
    if (Date.now() < retryAt && cooldownError) return Promise.reject(cooldownError);
    if (!(config == null ? void 0 : config.prefix) || !(config == null ? void 0 : config.sceneId) || typeof request !== "function") {
      return Promise.reject(new CaptchaError(t("\u98CE\u63A7\u9A8C\u8BC1\u914D\u7F6E\u4E0D\u5B8C\u6574\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5")));
    }
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const flow = {
        protocol: options.protocol === "v3" ? "v3" : "v2",
        elementId: `aliyun-captcha-element-${id}`,
        buttonId: `aliyun-captcha-trigger-${id}`,
        request,
        signal,
        resolve,
        reject,
        timer: 0,
        instance: null,
        initializedAt: 0,
        settled: false,
        submitting: false,
        onPhase: options.onPhase,
        onAbort: null
      };
      flow.onAbort = () => {
        if (!flow.submitting) settle(flow, null, new CaptchaCancelledError());
      };
      active = flow;
      signal == null ? void 0 : signal.addEventListener("abort", flow.onAbort, {
        once: true
      });
      onPhase(flow, "preparing");
      armTimeout(flow, SCRIPT_TIMEOUT_MS + INIT_TIMEOUT_MS + WARMUP_MS, t("\u9A8C\u8BC1\u7801\u7EC4\u4EF6\u521D\u59CB\u5316\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5"));
      void initialize(flow, __spreadProps(__spreadValues({}, config), {
        region: config.region || "cn"
      })).catch(error => {
        settle(flow, null, errorOf(error));
      });
    });
  }
  function cancel() {
    return active && !active.submitting ? settle(active, null, new CaptchaCancelledError()) : false;
  }
  const requestToken = (config, signal, options = {}) => solve(config, param => __async(null, null, function* () {
    return {
      param
    };
  }), signal, __spreadProps(__spreadValues({}, options), {
    protocol: "v3"
  }));
  window.addEventListener("pagehide", () => {
    if (active) settle(active, null, new CaptchaCancelledError());
  });
  window.wbAliyunCaptcha = {
    solve,
    requestToken,
    cancel,
    isBusy: () => active !== null,
    CaptchaError,
    CaptchaCancelledError
  };
})();