/*
 * APK 兜底补丁（ES2019 基线）
 * ────────────────────────────────────────────────────────────
 * 为什么需要：APK 的界面跑在系统 WebView 里，而 Android 的 WebView 由
 * 用户自己更新 —— 出厂即停更的机器能低到 Chrome 60 一代。Vite 的 esbuild
 * 只降语法、不降 API，产物里仍带着 Object.hasOwn / Array.prototype.at，
 * 这些在老 WebView 上是 undefined / TypeError，脚本一抛错，React 就整块
 * 不挂载，用户看到的就是白屏。
 *
 * 这里只补齐"桌面端页面上根本没用到、但依赖链顺手写了"的那几个 API，
 * 全部写成可覆盖的空实现：原生存在就跳过，绝不改写原生行为。
 *
 * 这一段是经典脚本，在 mobile.js 之前同步执行，所以必须自己保证语法是
 * ES5 级别（老 WebView 解析不了的括号会在加载阶段就报错）。
 */
(function () {
  'use strict';

  var proto = Array.prototype;

  // Object.hasOwn —— ES2022。旧实现只有 hasOwnProperty，且会被原型链上的
  // 同名属性劫持，所以这里走 call 保住语义。
  if (typeof Object.hasOwn !== 'function') {
    Object.hasOwn = function hasOwn(obj, key) {
      return Object.prototype.hasOwnProperty.call(Object(obj), key);
    };
  }

  // Array.prototype.at —— ES2022。负下标是本方法唯一的行为差异。
  if (typeof proto.at !== 'function') {
    proto.at = function at(index) {
      var len = this.length >>> 0;
      var i = Number(index) || 0;
      if (i < 0) i += len;
      if (i < 0 || i >= len) return undefined;
      return this[i];
    };
  }

  // String.prototype.at / TypedArray.prototype.at 是同一套语义，顺手给上
  if (typeof String.prototype.at !== 'function') {
    String.prototype.at = function at(index) {
      var i = Number(index) || 0;
      var len = this.length;
      if (i < 0) i += len;
      if (i < 0 || i >= len) return undefined;
      return this.charAt(i);
    };
  }
  if (typeof Uint8Array !== 'undefined' && typeof Uint8Array.prototype.at !== 'function') {
    Uint8Array.prototype.at = proto.at;
  }

  // Array.prototype.flatMap —— ES2019，依赖引擎的 Symbol.species，
  // 这里用 ECMA-262 规定的等价展开写法，不依赖 Symbol。
  if (typeof proto.flatMap !== 'function') {
    proto.flatMap = function flatMap(fn, thisArg) {
      if (typeof fn !== 'function') throw new TypeError(String(fn) + ' is not a function');
      var out = [];
      var len = this.length >>> 0;
      for (var i = 0; i < len; i++) {
        var mapped = fn.call(thisArg, this[i], i, this);
        if (Array.isArray(mapped)) {
          for (var j = 0; j < mapped.length; j++) out.push(mapped[j]);
        } else {
          out.push(mapped);
        }
      }
      return out;
    };
  }

  // Object.fromEntries —— ES2019，依赖 Symbol.iterator，用 entries 展开。
  if (typeof Object.fromEntries !== 'function') {
    Object.fromEntries = function fromEntries(iter) {
      var obj = {};
      var list = Array.isArray(iter) ? iter : Array.from(iter);
      for (var i = 0; i < list.length; i++) {
        var pair = list[i];
        obj[pair[0]] = pair[1];
      }
      return obj;
    };
  }

  // Array.prototype.findLast —— ES2023，React 19 的 diff 逻辑会用到。
  if (typeof proto.findLast !== 'function') {
    proto.findLast = function findLast(fn, thisArg) {
      for (var i = this.length - 1; i >= 0; i--) {
        if (fn.call(thisArg, this[i], i, this)) return this[i];
      }
      return undefined;
    };
  }

  // globalThis —— ES2020
  if (typeof globalThis === 'undefined') {
    try {
      Object.defineProperty(window, 'globalThis', { value: window, configurable: true });
    } catch (e) {
      window.globalThis = window;
    }
  }

  // queueMicrotask —— 旧 WebView 没有，退化成 Promise 微任务（语义一致）
  if (typeof window.queueMicrotask !== 'function') {
    var resolved = typeof Promise !== 'undefined' ? Promise.resolve() : null;
    window.queueMicrotask = function queueMicrotask(fn) {
      if (resolved) {
        resolved.then(function () {
          try { fn(); } catch (e) { setTimeout(function () { throw e; }, 0); }
        });
      } else {
        setTimeout(fn, 0);
      }
    };
  }

  /*
   * 诊断钩子：白屏时把原因留在页面上，而不是让用户对着空白屏猜。
   * 只在 window.__a2aFatal 未被置位时写一次，避免多个错误互相覆盖。
   */
  window.__a2aFatal = window.__a2aFatal || function (reason) {
    try {
      var root = document.getElementById('root');
      var text = String(reason && (reason.stack || reason.message) || reason);
      if (root) {
        root.innerHTML = '<pre style="margin:0;padding:20px;font:12px/1.7 monospace;' +
          'color:#c00;white-space:pre-wrap;word-break:break-all">' +
          '启动失败：' + text.replace(/[<>&]/g, function (c) {
            return { '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c];
          }) +
          '\n\n请把这段发给维护者；如果是旧手机，多半是系统 WebView 太老。</pre>';
      }
    } catch (e) { /* 页面已经坏到连容器都写不进去，只能放弃 */ }
  };

  window.addEventListener('error', function (ev) {
    if (ev && (ev.error || ev.message)) window.__a2aFatal(ev.error || ev.message);
  });
  window.addEventListener('unhandledrejection', function (ev) {
    if (ev && ev.reason) window.__a2aFatal(ev.reason);
  });
})();