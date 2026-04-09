(function () {
  'use strict';

  var tenantId =
    (document.currentScript && document.currentScript.getAttribute('data-tenant-id')) ||
    null;

  if (!tenantId) {
    console.warn('[Sahay] widget.js: missing data-tenant-id attribute');
    return;
  }

  // ─── Inject styles ──────────────────────────────────────────────────────────

  var style = document.createElement('style');
  style.textContent = [
    '#sahay-widget-btn {',
    '  position: fixed; bottom: 24px; right: 24px;',
    '  width: 60px; height: 60px; border-radius: 50%;',
    '  background: #4F46E5; cursor: pointer; border: none;',
    '  box-shadow: 0 4px 24px rgba(79,70,229,0.4);',
    '  display: flex; align-items: center; justify-content: center;',
    '  z-index: 2147483647; transition: transform 0.2s;',
    '  outline: none; padding: 0;',
    '}',
    '#sahay-widget-btn:hover { transform: scale(1.1); }',
    '#sahay-widget-btn:focus-visible {',
    '  box-shadow: 0 4px 24px rgba(79,70,229,0.4), 0 0 0 3px #fff, 0 0 0 5px #4F46E5;',
    '}',
    '#sahay-widget-badge {',
    '  position: absolute; top: -4px; right: -4px;',
    '  background: #ef4444; color: #fff; border-radius: 50%;',
    '  width: 20px; height: 20px; font-size: 11px; font-weight: 600;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
    '  display: none; align-items: center; justify-content: center;',
    '  pointer-events: none; line-height: 1;',
    '}',
    '#sahay-chat-frame {',
    '  position: fixed; bottom: 96px; right: 24px;',
    '  width: 380px; height: 600px; border: none; border-radius: 16px;',
    '  box-shadow: 0 8px 40px rgba(0,0,0,0.18); z-index: 2147483646;',
    '  display: none; overflow: hidden;',
    '}',
    '#sahay-chat-frame.sahay-open {',
    '  display: block;',
    '}',
    '@media (max-width: 440px) {',
    '  #sahay-chat-frame {',
    '    width: calc(100vw - 16px); height: calc(100vh - 100px);',
    '    bottom: 84px; right: 8px; border-radius: 12px;',
    '  }',
    '  #sahay-widget-btn { bottom: 16px; right: 16px; }',
    '}',
  ].join('\n');
  document.head.appendChild(style);

  // ─── SVG helper ──────────────────────────────────────────────────────────────

  var NS = 'http://www.w3.org/2000/svg';

  function makeSvg(attrs) {
    var el = document.createElementNS(NS, 'svg');
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) {
        el.setAttribute(k, attrs[k]);
      }
    }
    return el;
  }

  function makePath(d) {
    var el = document.createElementNS(NS, 'path');
    el.setAttribute('d', d);
    return el;
  }

  function makeLine(x1, y1, x2, y2) {
    var el = document.createElementNS(NS, 'line');
    el.setAttribute('x1', x1);
    el.setAttribute('y1', y1);
    el.setAttribute('x2', x2);
    el.setAttribute('y2', y2);
    return el;
  }

  // ─── Build DOM ───────────────────────────────────────────────────────────────

  // Button
  var btn = document.createElement('button');
  btn.id = 'sahay-widget-btn';
  btn.setAttribute('aria-label', 'Open chat');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-haspopup', 'dialog');

  // Chat icon (speech bubble — shown when closed)
  var iconChat = makeSvg({
    id: 'sahay-icon-chat',
    width: '28', height: '28',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: '#fff',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  });
  iconChat.appendChild(
    makePath('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z')
  );

  // Close icon (X — shown when open)
  var iconClose = makeSvg({
    id: 'sahay-icon-close',
    width: '24', height: '24',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: '#fff',
    'stroke-width': '2.5',
    'stroke-linecap': 'round',
  });
  iconClose.appendChild(makeLine('18', '6', '6', '18'));
  iconClose.appendChild(makeLine('6', '6', '18', '18'));
  iconClose.style.display = 'none';

  // Unread badge
  var badge = document.createElement('span');
  badge.id = 'sahay-widget-badge';
  badge.setAttribute('aria-live', 'polite');
  badge.setAttribute('aria-label', 'unread messages');

  btn.appendChild(iconChat);
  btn.appendChild(iconClose);
  btn.appendChild(badge);

  // Iframe — src set lazily on first open
  var iframe = document.createElement('iframe');
  iframe.id = 'sahay-chat-frame';
  iframe.setAttribute('role', 'dialog');
  iframe.setAttribute('aria-label', 'Sahay chat');
  iframe.title = 'Sahay chat';

  document.body.appendChild(iframe);
  document.body.appendChild(btn);

  // ─── State ───────────────────────────────────────────────────────────────────

  var isOpen = false;
  var iframeLoaded = false;
  var CHAT_BASE = 'https://sahay.ai';

  // ─── Badge ───────────────────────────────────────────────────────────────────

  function setUnread(count) {
    if (count > 0 && !isOpen) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }

  // ─── postMessage bridge ──────────────────────────────────────────────────────

  function postToIframe(data) {
    try {
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage(data, CHAT_BASE);
      }
    } catch (_) {
      // silently ignore cross-origin errors
    }
  }

  // ─── Open / Close ────────────────────────────────────────────────────────────

  function openChat() {
    if (!iframeLoaded) {
      iframe.src = CHAT_BASE + '/chat?tenantId=' + encodeURIComponent(tenantId);
      iframeLoaded = true;
    }
    isOpen = true;
    iframe.classList.add('sahay-open');
    iconChat.style.display = 'none';
    iconClose.style.display = '';
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-label', 'Close chat');
    setUnread(0);
    postToIframe({ type: 'sahay:open' });
  }

  function closeChat() {
    isOpen = false;
    iframe.classList.remove('sahay-open');
    iconChat.style.display = '';
    iconClose.style.display = 'none';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Open chat');
    postToIframe({ type: 'sahay:close' });
  }

  btn.addEventListener('click', function () {
    if (isOpen) { closeChat(); } else { openChat(); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen) closeChat();
  });

  // ─── Receive messages from iframe ────────────────────────────────────────────

  window.addEventListener('message', function (event) {
    if (event.origin !== CHAT_BASE) return;
    var data = event.data;
    if (!data || typeof data !== 'object') return;

    switch (data.type) {
      case 'sahay:unread':
        if (typeof data.count === 'number') setUnread(data.count);
        break;
      case 'sahay:close':
        closeChat();
        break;
      case 'sahay:open':
        if (!isOpen) openChat();
        break;
      default:
        break;
    }
  });

  // ─── Public API ───────────────────────────────────────────────────────────────

  window.SahayWidget = {
    open: openChat,
    close: closeChat,
    setUnread: setUnread,
    get isOpen() { return isOpen; },
  };
})();
