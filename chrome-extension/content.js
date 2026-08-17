// chrome-extension/content.js — 페이지 fetch/XHR 후킹 (범용 웹메일)
(function () {
  if (window.__oksooMailHookInstalled) return;
  window.__oksooMailHookInstalled = true;

  const HOOK_RE = /\/(send|compose|mail\/send|mail\/write|smtp|delivery|dispatch|submit|api\/mail|process|popup\/process|mail\/process|reply|forward|mail\/reply|mail\/forward|re|fw)/i;

  function shouldHook(url, method) {
    if (!url || (method && method.toUpperCase() !== 'POST')) return false;
    try {
      const u = new URL(url, location.href);
      const host = u.hostname.toLowerCase();
      const pathStr = u.pathname + u.search;
      if (host.includes('mail') || host.includes('groupware') || host.includes('daouoffice') || host.includes('daou') || host.includes('naver') || host.includes('worksmobile')) {
        return HOOK_RE.test(pathStr) || pathStr.includes('write') || pathStr.includes('send') || pathStr.includes('process') || pathStr.includes('mail') || pathStr.includes('reply') || pathStr.includes('forward');
      }
      return HOOK_RE.test(pathStr);
    } catch (_) {
      return HOOK_RE.test(String(url));
    }
  }

  function parseBody(body) {
    if (!body) return { recipients: [], subject: '', body: '', sender: '' };
    if (typeof body === 'string') {
      try {
        return window.MailParser.parseFormDataText(body);
      } catch (_) {
        return { recipients: [], subject: '', body: body.slice(0, 8000), sender: '' };
      }
    }
    if (body instanceof FormData) {
      const obj = {};
      for (const [k, v] of body.entries()) {
        if (typeof File !== 'undefined' && v instanceof File) continue;
        if (typeof Blob !== 'undefined' && v instanceof Blob) continue;
        obj[k] = obj[k] ? [].concat(obj[k], v) : v;
      }
      const found = { recipients: [], subject: '', body: '', sender: '' };
      window.MailParser && (function walk(o, d) {
        if (!o || d > 6) return;
        if (typeof o === 'object') {
          for (const [k, v] of Object.entries(o)) {
            if (typeof File !== 'undefined' && v instanceof File) continue;
            if (typeof Blob !== 'undefined' && v instanceof Blob) continue;
            try {
              const valStr = typeof v === 'string' ? v : (v && typeof v === 'object' ? JSON.stringify(v) : String(v));
              const partial = window.MailParser.parseFormDataText(`${k}=${valStr}`);
              found.recipients.push(...partial.recipients);
              if (!found.subject && partial.subject) found.subject = partial.subject;
              if ((partial.body || '').length > (found.body || '').length) found.body = partial.body;
            } catch (_) {}
          }
        }
      })(obj, 0);
      return found;
    }
    try {
      return window.MailParser.parseFormDataText(JSON.stringify(body));
    } catch (_) {
      return { recipients: [], subject: '', body: '', sender: '' };
    }
  }

  function emitMailSend(url, parsed) {
    const payload = window.MailParser.buildMailPayload(url, parsed, {
      pageUrl: location.href
    });
    if (!payload.title && !payload.recipients.length && !payload.body) return;
    chrome.runtime.sendMessage({
      type: 'mail_send_detected',
      payload
    }).catch(() => {});
  }

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input?.url;
    const method = init?.method || 'GET';
    if (shouldHook(url, method)) {
      try {
        const parsed = parseBody(init?.body);
        emitMailSend(url, parsed);
      } catch (_) {}
    }
    return origFetch.apply(this, args);
  };

  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSend = XHR.send;

  XHR.open = function (method, url, ...rest) {
    this.__oksooMethod = method;
    this.__oksooUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };

  XHR.send = function (body) {
    if (shouldHook(this.__oksooUrl, this.__oksooMethod)) {
      try {
        const parsed = parseBody(body);
        emitMailSend(this.__oksooUrl, parsed);
      } catch (_) {}
    }
    return origSend.call(this, body);
  };
})();
