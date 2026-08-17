// chrome-extension/lib/mail-parser.js — 범용 웹메일 POST Body 파서
(function (root) {
  const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const SEND_URL_RE = /\/(send|compose|mail\/send|mail\/write|smtp|delivery|dispatch|submit|api\/mail|process|popup\/process|mail\/process|reply|forward|mail\/reply|mail\/forward|re|fw)/i;

  const RECIPIENT_KEYS = [
    'to', 'cc', 'bcc', 'recipient', 'recipients', 'receiver', 'receivers',
    'toList', 'to_list', 'toAddress', 'to_address', 'toAddr', 'rcpt', 'rcptTo',
    'mailTo', 'mail_to', 'target', 'targets', 'receiverList', 'receiver_list',
    '수신', '받는사람', '받는 사람', '참조', 'toUser', 'toUsers', 'rcptNames',
    'userList', 'selectUser', 'empName', 'targetNames', 'users'
  ];

  const SUBJECT_KEYS = [
    'subject', 'title', 'mailSubject', 'mail_subject', 'subj', 'topic',
    '제목', 'mailTitle', 'header'
  ];

  const BODY_KEYS = [
    'body', 'content', 'message', 'text', 'html', 'htmlBody', 'html_body',
    'textBody', 'text_body', 'mailBody', 'mail_body', 'contents', 'detail',
    '본문', 'memo', 'note', 'editorContent', 'editor_content', 'rawBody'
  ];

  const SENDER_KEYS = ['from', 'sender', 'fromAddress', 'from_address', '보낸사람', 'fromAddr'];

  function stripHtml(html) {
    if (!html || typeof html !== 'string') return '';
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripDisclaimer(body) {
    if (!body || typeof body !== 'string') return '';
    const patterns = [
      /이\s*(이)?메일은\s*(지정된\s*)?수신자/i,
      /본\s*메일은\s*(지정된\s*)?수신/i,
      /이\s*메일에\s*포함된/i,
      /수신자만을\s*위한/i,
      /기밀\s*정보가\s*포함/i,
      /transmitted\s*copy\s*is\s*intended/i,
      /this\s*email\s*is\s*intended/i,
      /this\s*message\s*contains\s*confidential/i
    ];
    
    let earliestIndex = -1;
    for (const pattern of patterns) {
      const match = body.match(pattern);
      if (match && match.index !== undefined) {
        if (earliestIndex === -1 || match.index < earliestIndex) {
          earliestIndex = match.index;
        }
      }
    }

    if (earliestIndex !== -1) {
      return body.substring(0, earliestIndex).trim();
    }
    return body.trim();
  }

  function extractEmails(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val.flatMap(extractEmails);
    const s = typeof val === 'object' ? JSON.stringify(val) : String(val);
    const found = s.match(EMAIL_RE) || [];
    if (found.length > 0) return [...new Set(found)];
    if (typeof val === 'string' && val.trim().length > 1 && !val.includes('{') && !val.includes('<') && !val.includes('/')) {
      return [val.trim()];
    }
    return [];
  }

  function firstString(val) {
    if (val == null) return '';
    if (typeof val === 'string') return val.trim();
    if (typeof val === 'number') return String(val);
    if (Array.isArray(val)) {
      for (const item of val) {
        const s = firstString(item);
        if (s) return s;
      }
      return '';
    }
    if (typeof val === 'object') {
      for (const k of ['email', 'address', 'addr', 'value', 'name', 'displayName', 'id']) {
        if (val[k]) return firstString(val[k]);
      }
      return JSON.stringify(val);
    }
    return String(val).trim();
  }

  function walkObject(obj, depth, found) {
    if (!obj || depth > 8) return;
    if (typeof obj !== 'object') return;

    if (Array.isArray(obj)) {
      obj.forEach(v => walkObject(v, depth + 1, found));
      return;
    }

    for (const [key, val] of Object.entries(obj)) {
      const lk = key.toLowerCase();
      if (RECIPIENT_KEYS.some(k => lk.includes(k.toLowerCase()))) {
        found.recipients.push(...extractEmails(val));
        found.recipients.push(...extractEmails(firstString(val)));
      }
      if (SUBJECT_KEYS.some(k => lk.includes(k.toLowerCase()))) {
        if (!found.subject) found.subject = firstString(val);
      }
      if (BODY_KEYS.some(k => lk.includes(k.toLowerCase()))) {
        const isExcluded = ['sign', 'sig', 'footer', 'tail', 'template', 'disclaimer', 'header', 'style', 'css'].some(ex => lk.includes(ex));
        if (!isExcluded) {
          const body = firstString(val);
          if (body.length > (found.body || '').length) found.body = body;
        }
      }
      if (SENDER_KEYS.some(k => lk.includes(k.toLowerCase()))) {
        if (!found.sender) found.sender = firstString(val);
      }
      walkObject(val, depth + 1, found);
    }
  }

  function parseFormDataText(text) {
    let found = { recipients: [], subject: '', body: '', sender: '' };
    if (!text) return found;

    const trimmed = text.trim();

    // 1. JSON first
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const json = JSON.parse(trimmed);
        walkObject(json, 0, found);
        
        found.recipients = [...new Set(found.recipients.filter(Boolean))];
        if (found.body && found.body.includes('<')) found.body = stripHtml(found.body);
        return found;
      } catch (_) {}
    }

    // 2. Gmail GWT-RPC or vertical-bar format
    if (trimmed.includes('|') && trimmed.length > 20) {
      const parts = trimmed.split('|');
      const emails = [];
      let subject = '';
      let body = '';
      
      for (const part of parts) {
        const p = part.trim();
        if (!p) continue;
        
        if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(p)) {
          emails.push(p);
        } else if (p.includes('<p') || p.includes('<div') || (p.length > 50 && p.includes(' '))) {
          if (p.length > body.length) {
            body = p;
          }
        } else if (p.length > 3 && p.length < 150 && !p.startsWith('http') && !p.includes('/') && !p.includes('\\') && !p.includes('=')) {
          if (!subject || p.length > subject.length) {
            subject = p;
          }
        }
      }
      
      if (emails.length > 0 || subject || body) {
        found.recipients = [...new Set(emails)];
        found.subject = subject;
        found.body = body;
        return found;
      }
    }

    // 3. Fallback to URLSearchParams only if it's not JSON
    const params = new URLSearchParams(trimmed);
    for (const [key, val] of params.entries()) {
      if (key === trimmed) continue;
      walkObject({ [key]: val }, 0, found);
    }

    found.recipients = [...new Set(found.recipients.filter(Boolean))];
    if (found.body && found.body.includes('<')) found.body = stripHtml(found.body);
    return found;
  }

  function parseRequestBody(requestBody) {
    const found = { recipients: [], subject: '', body: '', sender: '' };
    if (!requestBody) return found;

    if (requestBody.raw) {
      for (const part of requestBody.raw) {
        if (!part.bytes) continue;
        // Skip huge binary file buffers (>2MB) to prevent freeze & crash
        if (part.bytes.byteLength > 2 * 1024 * 1024) continue;
        const u8 = new Uint8Array(part.bytes);
        // Skip binary file magic headers (ZIP: PK\x03\x04, PDF: %PDF, PNG, etc)
        if (u8.length > 4) {
          if (u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04) continue; // ZIP file
          if (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) continue; // PDF file
        }
        try {
          const text = new TextDecoder('utf-8', { fatal: false }).decode(u8);
          const partial = parseFormDataText(text);
          found.recipients.push(...partial.recipients);
          if (!found.subject && partial.subject) found.subject = partial.subject;
          if ((partial.body || '').length > (found.body || '').length) found.body = partial.body;
          if (!found.sender && partial.sender) found.sender = partial.sender;
        } catch (_) {}
      }
    }

    if (requestBody.formData) {
      walkObject(requestBody.formData, 0, found);
    }

    found.recipients = [...new Set(found.recipients.filter(Boolean))];
    if (found.body && found.body.includes('<')) found.body = stripHtml(found.body);
    return found;
  }

  function isMailSendUrl(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const pathStr = u.pathname + u.search;
      if (host.includes('daouoffice') || host.includes('daou') || host.includes('groupware')) {
        return SEND_URL_RE.test(pathStr) || pathStr.includes('process') || pathStr.includes('write') || pathStr.includes('send') || pathStr.includes('mail') || pathStr.includes('reply') || pathStr.includes('forward');
      }
      if (!host.includes('mail') && !host.includes('groupware') && !host.includes('office') && !host.includes('daou') && !host.includes('worksmobile')) {
        if (!SEND_URL_RE.test(pathStr)) return false;
      }
      return SEND_URL_RE.test(pathStr) ||
        pathStr.includes('process') ||
        pathStr.includes('reply') ||
        pathStr.includes('forward') ||
        host.includes('mail.naver') ||
        host.includes('worksmobile') ||
        host.includes('mail.google') ||
        host.includes('daouoffice') ||
        host.includes('mail.daum') ||
        host.includes('outlook');
    } catch (_) {
      return SEND_URL_RE.test(String(url));
    }
  }

  function detectBrowser() {
    const ua = navigator.userAgent;
    if (ua.includes('Whale')) return 'Whale';
    if (ua.includes('Edg/')) return 'Edge';
    return 'Chrome';
  }

  function buildMailPayload(url, parsed, extra) {
    let mailHost = '';
    try { mailHost = new URL(url).hostname; } catch (_) {}
    return {
      browser: detectBrowser(),
      mail_host: mailHost,
      sender: parsed.sender || extra.sender || '',
      recipients: parsed.recipients || [],
      title: parsed.subject || extra.subject || '',
      body: stripDisclaimer(parsed.body || extra.body || '').slice(0, 8000),
      pageUrl: extra.pageUrl || url,
      timestamp: new Date().toISOString()
    };
  }

  root.MailParser = {
    parseFormDataText,
    parseRequestBody,
    isMailSendUrl,
    buildMailPayload,
    stripHtml,
    extractEmails
  };
})(typeof self !== 'undefined' ? self : this);
