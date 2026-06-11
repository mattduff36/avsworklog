import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const legacyDisplayBoardHtml = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Workshop Display Board TV</title>
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body {
      background: #020617;
      color: #fff;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 20px;
    }
    .boot {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      padding: 80px;
      background: #020617;
      text-align: center;
    }
    .boot-card {
      width: 760px;
      max-width: 90%;
      margin: 12% auto 0;
      padding: 52px;
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 28px;
      background: rgba(255,255,255,0.055);
    }
    .boot h1 { margin: 0; font-size: 58px; line-height: 1.05; }
    .boot-message { margin-top: 28px; color: rgba(255,255,255,0.72); font-size: 28px; }
    .pair-code {
      margin: 36px auto 0;
      padding: 26px 28px;
      border: 1px solid rgba(180,99,68,0.65);
      border-radius: 24px;
      background: rgba(180,99,68,0.22);
      font-size: 78px;
      font-weight: 900;
      letter-spacing: 18px;
    }
    .muted { color: rgba(255,255,255,0.55); }
    .board {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      padding: 24px;
      background: #020617;
      background: -webkit-linear-gradient(315deg, #020617, #0f172a 48%, #111827);
      background: linear-gradient(135deg, #020617, #0f172a 48%, #111827);
    }
    .header {
      position: absolute;
      top: 24px;
      left: 24px;
      right: 24px;
      height: 108px;
      padding: 22px 28px;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 26px;
      background: rgba(255,255,255,0.06);
    }
    .brand { color: #f0b293; font-size: 17px; font-weight: 800; letter-spacing: 5px; text-transform: uppercase; }
    .title { margin-top: 3px; font-size: 43px; line-height: 1; font-weight: 900; }
    .status {
      position: absolute;
      top: 24px;
      right: 30px;
      text-align: right;
      color: rgba(255,255,255,0.7);
      font-size: 17px;
    }
    .status strong { display: block; color: #fff; font-size: 28px; }
    .stats {
      position: absolute;
      top: 150px;
      left: 24px;
      right: 24px;
      height: 140px;
      overflow: hidden;
    }
    .tile {
      float: left;
      width: 13.42%;
      height: 128px;
      margin-right: 1%;
      padding: 18px;
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 20px;
      background: rgba(255,255,255,0.07);
    }
    .tile-last { margin-right: 0; }
    .tile-label { color: rgba(255,255,255,0.68); font-size: 15px; font-weight: 800; letter-spacing: 3px; text-transform: uppercase; }
    .tile-value { margin-top: 10px; font-size: 54px; line-height: 1; font-weight: 900; }
    .tone-red { border-color: rgba(239,68,68,0.46); background: rgba(239,68,68,0.15); }
    .tone-amber { border-color: rgba(245,158,11,0.46); background: rgba(245,158,11,0.15); }
    .tone-blue { border-color: rgba(59,130,246,0.46); background: rgba(59,130,246,0.15); }
    .tone-purple { border-color: rgba(168,85,247,0.46); background: rgba(168,85,247,0.15); }
    .panel {
      position: absolute;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 26px;
      background: rgba(255,255,255,0.055);
      overflow: hidden;
    }
    .panel-maintenance {
      left: 24px;
      top: 312px;
      bottom: 24px;
      width: 48%;
    }
    .panel-pending { left: 51%; right: 24px; top: 312px; height: 30%; border-color: rgba(245,158,11,0.22); }
    .panel-progress { left: 51%; right: 24px; top: 54%; height: 20.5%; border-color: rgba(59,130,246,0.22); }
    .panel-hold { left: 51%; right: 24px; top: 76.5%; bottom: 24px; border-color: rgba(168,85,247,0.22); }
    .panel-title-small { color: rgba(255,255,255,0.65); font-size: 15px; font-weight: 800; letter-spacing: 4px; text-transform: uppercase; }
    .panel-title { margin: 5px 0 14px; font-size: 32px; line-height: 1; font-weight: 900; }
    .scroll-panel {
      position: absolute;
      top: 86px;
      right: 18px;
      bottom: 18px;
      left: 18px;
      overflow: hidden;
    }
    .row {
      min-height: 76px;
      margin-bottom: 12px;
      padding: 14px 16px;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      background: rgba(255,255,255,0.06);
      overflow: hidden;
    }
    .row-overdue { border-color: rgba(239,68,68,0.38); background: rgba(239,68,68,0.12); }
    .row-due { border-color: rgba(245,158,11,0.38); background: rgba(245,158,11,0.12); }
    .row-progress { border-color: rgba(59,130,246,0.34); background: rgba(59,130,246,0.11); }
    .row-hold { border-color: rgba(168,85,247,0.34); background: rgba(168,85,247,0.11); }
    .row-main { float: left; width: 72%; }
    .row-title { font-size: 25px; font-weight: 900; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row-sub { margin-top: 5px; color: rgba(255,255,255,0.72); font-size: 18px; line-height: 1.25; max-height: 46px; overflow: hidden; }
    .tag {
      float: right;
      max-width: 26%;
      padding: 8px 10px;
      border: 1px solid rgba(255,255,255,0.24);
      border-radius: 12px;
      color: rgba(255,255,255,0.88);
      font-size: 16px;
      font-weight: 800;
      text-align: right;
    }
    .empty {
      padding: 40px;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 16px;
      color: rgba(255,255,255,0.55);
      text-align: center;
    }
    .text-step-1 .row-title { font-size: 20px; }
    .text-step-1 .row-sub { font-size: 14px; }
    .text-step-2 .row-title { font-size: 22px; }
    .text-step-2 .row-sub { font-size: 16px; }
    .text-step-4 .row-title { font-size: 28px; }
    .text-step-4 .row-sub { font-size: 20px; }
    .text-step-5 .row-title { font-size: 31px; }
    .text-step-5 .row-sub { font-size: 22px; }
  </style>
</head>
<body>
  <div id="app" class="boot">
    <div class="boot-card">
      <h1>Workshop Display Board</h1>
      <div class="boot-message">Loading display board...</div>
    </div>
  </div>
  <script>
    (function () {
      var DEVICE_TOKEN_STORAGE_KEY = 'displayboard-workshop-device-token';
      var PAIRING_TOKEN_STORAGE_KEY = 'displayboard-workshop-pairing-token';
      var app = document.getElementById('app');
      var refreshTimer = null;
      var scrollTimers = [];

      function escapeHtml(value) {
        var text = value == null ? '' : String(value);
        return text.replace(/[&<>"']/g, function (character) {
          return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
          }[character];
        });
      }

      function storageGet(key) {
        try { return window.localStorage.getItem(key) || ''; } catch (error) { return ''; }
      }

      function storageSet(key, value) {
        try { window.localStorage.setItem(key, value); } catch (error) {}
      }

      function storageRemove(key) {
        try { window.localStorage.removeItem(key); } catch (error) {}
      }

      function requestJson(method, url, callback) {
        var xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.onreadystatechange = function () {
          var body;
          if (xhr.readyState !== 4) return;
          try {
            body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
          } catch (error) {
            callback(new Error('The display board received an unreadable response.'), null, xhr.status);
            return;
          }
          callback(null, body, xhr.status);
        };
        xhr.onerror = function () {
          callback(new Error('The display board could not reach the server.'), null, xhr.status);
        };
        xhr.send(null);
      }

      function pad(value) {
        return value < 10 ? '0' + value : String(value);
      }

      function formatTime(value) {
        var date = value ? new Date(value) : new Date();
        if (isNaN(date.getTime())) return '--:--';
        return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
      }

      function formatDateTime(value) {
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var date = value ? new Date(value) : null;
        if (!date || isNaN(date.getTime())) return 'Unknown';
        return pad(date.getDate()) + ' ' + months[date.getMonth()] + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
      }

      function clearRefresh() {
        if (refreshTimer) window.clearTimeout(refreshTimer);
        refreshTimer = null;
      }

      function stopAutoScroll() {
        var index;
        for (index = 0; index < scrollTimers.length; index += 1) {
          window.clearInterval(scrollTimers[index]);
        }
        scrollTimers = [];
      }

      function startAutoScroll() {
        var panels = document.getElementsByClassName('scroll-panel');
        var index;
        stopAutoScroll();
        for (index = 0; index < panels.length; index += 1) {
          (function (panel) {
            var timer = window.setInterval(function () {
              if (panel.scrollHeight <= panel.clientHeight + 2) return;
              panel.scrollTop += 1;
              if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 1) {
                panel.scrollTop = 0;
              }
            }, 90);
            scrollTimers.push(timer);
          }(panels[index]));
        }
      }

      function showBoot(message) {
        stopAutoScroll();
        app.className = 'boot';
        app.innerHTML = '<div class="boot-card"><h1>Workshop Display Board</h1><div class="boot-message">' + escapeHtml(message) + '</div></div>';
      }

      function showUnauthorised(message) {
        showBoot(message || 'This display board is not authorised.');
        schedulePairing(5000);
      }

      function showPairing(code, expiresAt) {
        stopAutoScroll();
        app.className = 'boot';
        app.innerHTML = '<div class="boot-card"><h1>Workshop Display Board</h1><div class="boot-message">Confirm this code in Admin Settings</div><div class="pair-code">' + escapeHtml(code) + '</div><p class="muted">Pairing expires at ' + escapeHtml(formatTime(expiresAt)) + '</p></div>';
        schedulePairing(3000);
      }

      function schedulePairing(delayMs) {
        clearRefresh();
        refreshTimer = window.setTimeout(tryJoinPairing, delayMs);
      }

      function scheduleBoardRefresh(delayMs) {
        clearRefresh();
        refreshTimer = window.setTimeout(loadBoard, delayMs);
      }

      function getItems(items, emptyLabel, rowClass, isTask) {
        var html = '';
        var item;
        var index;
        if (!items || items.length === 0) return '<div class="empty">' + escapeHtml(emptyLabel) + '</div>';
        for (index = 0; index < items.length; index += 1) {
          item = items[index];
          html += '<div class="row ' + rowClass + '">';
          html += '<div class="row-main">';
          html += '<div class="row-title">' + escapeHtml(item.asset) + '</div>';
          html += '<div class="row-sub">' + escapeHtml(isTask ? item.summary : item.category) + '</div>';
          html += '</div>';
          html += '<div class="tag">' + escapeHtml(isTask ? formatDateTime(item.created_at) : item.detail) + '</div>';
          html += '</div>';
        }
        return html;
      }

      function getMaintenanceRows(payload) {
        var rows = [];
        var index;
        var overdue = payload.maintenance && payload.maintenance.overdue_items ? payload.maintenance.overdue_items : [];
        var dueSoon = payload.maintenance && payload.maintenance.due_soon_items ? payload.maintenance.due_soon_items : [];
        for (index = 0; index < overdue.length; index += 1) rows.push(overdue[index]);
        for (index = 0; index < dueSoon.length; index += 1) rows.push(dueSoon[index]);
        return getItems(rows, 'No overdue or due soon maintenance.', 'row-overdue', false);
      }

      function tile(label, value, tone, isLast) {
        return '<div class="tile tone-' + tone + (isLast ? ' tile-last' : '') + '"><div class="tile-label">' + escapeHtml(label) + '</div><div class="tile-value">' + escapeHtml(value) + '</div></div>';
      }

      function renderBoard(payload) {
        var maintenanceTotals = payload.maintenance && payload.maintenance.summary ? payload.maintenance.summary : {};
        var workshopCounts = payload.workshop && payload.workshop.counts ? payload.workshop.counts : {};
        var textSize = payload.display && payload.display.text_size_step ? Number(payload.display.text_size_step) : 3;
        var pollSeconds = payload.config && payload.config.fallback_poll_interval_seconds ? Number(payload.config.fallback_poll_interval_seconds) : 60;
        if (textSize < 1 || textSize > 5) textSize = 3;
        app.className = 'board text-step-' + textSize;
        app.innerHTML =
          '<div class="header"><div class="brand">Squires Workshop</div><div class="title">Live Display Board</div><div class="status">Last update<strong>' + escapeHtml(formatTime(payload.generated_at)) + '</strong><span>TV fallback mode - refresh every ' + escapeHtml(pollSeconds) + 's</span></div></div>' +
          '<div class="stats">' +
            tile('All Assets', maintenanceTotals.total || 0, 'slate', false) +
            tile('Maintenance Overdue', maintenanceTotals.overdue || 0, 'red', false) +
            tile('Due Soon', maintenanceTotals.due_soon || 0, 'amber', false) +
            tile('High Priority', workshopCounts.high_priority || 0, 'red', false) +
            tile('Pending', workshopCounts.pending || 0, 'amber', false) +
            tile('In Progress', workshopCounts.in_progress || 0, 'blue', false) +
            tile('On Hold', workshopCounts.on_hold || 0, 'purple', true) +
          '</div>' +
          '<div class="panel panel-maintenance"><div class="panel-title-small">Maintenance</div><div class="panel-title">Urgent All Assets</div><div class="scroll-panel">' + getMaintenanceRows(payload) + '</div></div>' +
          '<div class="panel panel-pending"><div class="panel-title-small">Workshop</div><div class="panel-title">Pending</div><div class="scroll-panel">' + getItems(payload.workshop.pending, 'No pending workshop tasks.', 'row-due', true) + '</div></div>' +
          '<div class="panel panel-progress"><div class="panel-title-small">Workshop</div><div class="panel-title">In Progress</div><div class="scroll-panel">' + getItems(payload.workshop.in_progress, 'No tasks in progress.', 'row-progress', true) + '</div></div>' +
          '<div class="panel panel-hold"><div class="panel-title-small">Workshop</div><div class="panel-title">On Hold</div><div class="scroll-panel">' + getItems(payload.workshop.on_hold, 'No tasks on hold.', 'row-hold', true) + '</div></div>';
        startAutoScroll();
        scheduleBoardRefresh(Math.max(15, pollSeconds) * 1000);
      }

      function loadBoard() {
        var deviceToken = storageGet(DEVICE_TOKEN_STORAGE_KEY);
        if (!deviceToken) {
          tryJoinPairing();
          return;
        }

        requestJson('GET', '/api/display-board/workshop/data?device_token=' + encodeURIComponent(deviceToken) + '&_=' + Date.now(), function (error, body, status) {
          if (error) {
            showBoot(error.message);
            scheduleBoardRefresh(15000);
            return;
          }
          if (status === 401) {
            storageRemove(DEVICE_TOKEN_STORAGE_KEY);
            showUnauthorised(body && body.error ? body.error : 'This display board is not authorised.');
            return;
          }
          if (!body || body.status !== 'ok' || !body.payload) {
            showBoot(body && body.error ? body.error : 'Unable to load display board data.');
            scheduleBoardRefresh(15000);
            return;
          }
          renderBoard(body.payload);
        });
      }

      function startPairing() {
        requestJson('POST', '/api/display-board/workshop/pairing?_=' + Date.now(), function (error, body) {
          if (error) {
            showUnauthorised(error.message);
            return;
          }
          if (body && body.status === 'pairing' && body.confirmation_code && body.expires_at) {
            if (body.pairing_token) storageSet(PAIRING_TOKEN_STORAGE_KEY, body.pairing_token);
            showPairing(body.confirmation_code, body.expires_at);
            return;
          }
          showUnauthorised(body && body.message ? body.message : 'This display board is not authorised.');
        });
      }

      function tryJoinPairing() {
        var deviceToken = storageGet(DEVICE_TOKEN_STORAGE_KEY);
        var pairingToken;
        if (deviceToken) {
          loadBoard();
          return;
        }

        pairingToken = storageGet(PAIRING_TOKEN_STORAGE_KEY);
        if (!pairingToken) {
          startPairing();
          return;
        }

        requestJson('GET', '/api/display-board/workshop/pairing?pairing_token=' + encodeURIComponent(pairingToken) + '&_=' + Date.now(), function (error, body) {
          if (error) {
            showUnauthorised(error.message);
            return;
          }
          if (body && body.status === 'paired' && body.device_token) {
            storageSet(DEVICE_TOKEN_STORAGE_KEY, body.device_token);
            storageRemove(PAIRING_TOKEN_STORAGE_KEY);
            loadBoard();
            return;
          }
          if (body && body.status === 'pairing' && body.confirmation_code && body.expires_at) {
            showPairing(body.confirmation_code, body.expires_at);
            return;
          }
          storageRemove(PAIRING_TOKEN_STORAGE_KEY);
          startPairing();
        });
      }

      showBoot('Loading display board...');
      tryJoinPairing();
    }());
  </script>
</body>
</html>`;

export function GET() {
  return new NextResponse(legacyDisplayBoardHtml, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
