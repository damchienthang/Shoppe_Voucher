import { extractVoucherCodes } from '../utils/parser.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Navigation & Header Elements
  const navItems = document.querySelectorAll('.nav-item');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const activeTabTitle = document.getElementById('active-tab-title');
  const activeTabDesc = document.getElementById('active-tab-desc');

  // User & Server Clock Elements
  const userDisplayName = document.getElementById('user-display-name');
  const userAccountId = document.getElementById('user-account-id');
  const userAvatarImg = document.getElementById('user-avatar-img');
  const userOnlineDot = document.getElementById('user-online-dot');
  const btnRefreshUser = document.getElementById('btn-refresh-user');
  const dashServerTime = document.getElementById('dash-server-time');
  const dashServerMs = document.getElementById('dash-server-ms');
  const btnSyncTime = document.getElementById('btn-sync-time');

  // Tab 1: Batch Elements
  const batchInputCodes = document.getElementById('batch-input-codes');
  const batchDetectedCount = document.getElementById('batch-detected-count');
  const parsedTagsContainer = document.getElementById('parsed-tags-container');
  const batchDelaySlider = document.getElementById('batch-delay-slider');
  const batchDelayValue = document.getElementById('batch-delay-value');
  const btnRunBatch = document.getElementById('btn-run-batch');
  const btnStopBatch = document.getElementById('btn-stop-batch');
  const btnClearBatch = document.getElementById('btn-clear-batch');
  const btnExportResults = document.getElementById('btn-export-results');
  const statTotal = document.getElementById('stat-total');
  const statSuccess = document.getElementById('stat-success');
  const statFailed = document.getElementById('stat-failed');
  const batchProgressBar = document.getElementById('batch-progress-bar');
  const batchProgressLabel = document.getElementById('batch-progress-label');
  const batchProgressPercent = document.getElementById('batch-progress-percent');
  const batchResultsTbody = document.getElementById('batch-results-tbody');
  const filterPills = document.querySelectorAll('.filter-pill');

  const zaloEnableToggle = document.getElementById('zalo-enable-toggle');
  const zaloAutoclaimCodes = document.getElementById('zalo-autoclaim-codes');
  const zaloAutoopenLinks = document.getElementById('zalo-autoopen-links');
  const zaloShowWidgetToggle = document.getElementById('zalo-show-widget-toggle');
  const zaloStreamContainer = document.getElementById('zalo-stream-container');
  const btnClearZaloFeed = document.getElementById('btn-clear-zalo-feed');
  const zaloTargetGroupInput = document.getElementById('zalo-target-group-input');
  const btnSaveZaloGroup = document.getElementById('btn-save-zalo-group');
  const zaloActiveGroupLabel = document.getElementById('zalo-active-group-label');

  // Tab 3: Scheduler Elements
  const presetTimeBtns = document.querySelectorAll('.time-preset-btn');
  const customScheduleTime = document.getElementById('custom-schedule-time');
  const scheduleLeadTime = document.getElementById('schedule-lead-time');
  const leadTimeDisplay = document.getElementById('lead-time-display');
  const schedulerCodesInput = document.getElementById('scheduler-codes');
  const btnActivateSchedule = document.getElementById('btn-activate-schedule');
  const btnCancelSchedule = document.getElementById('btn-cancel-schedule');
  const countdownTargetText = document.getElementById('countdown-target-text');
  const cdHours = document.getElementById('cd-hours');
  const cdMins = document.getElementById('cd-mins');
  const cdSecs = document.getElementById('cd-secs');
  const cdMs = document.getElementById('cd-ms');
  const countdownStatusBox = document.getElementById('countdown-status-box');
  const scheduleStatusText = document.getElementById('schedule-status-text');

  // Tab 5 (now 4): Settings & Theme Elements
  const themeSelector = document.getElementById('theme-selector');
  const settingTheme = document.getElementById('setting-theme');
  const settingDefaultDelay = document.getElementById('setting-default-delay');
  const settingSound = document.getElementById('setting-sound');
  const settingFloatingWidget = document.getElementById('setting-floating-widget');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const settingsSaveMsg = document.getElementById('settings-save-msg');

  // State
  let timeOffsetMs = 0;
  let currentResults = [];
  let activeFilter = 'all';
  let countdownTimerId = null;
  let targetScheduleTimestamp = 0;

  // Sound Chime
  function playSuccessChime() {
    try {
      const { settingSoundVal = true } = window.__cachedSettings || {};
      if (!settingSoundVal) return;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime);
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    } catch (e) {
      // Audio context may be restricted before user interaction
    }
  }

  // -------------------------------------------------------------
  // 1. Navigation & Hash Routing
  // -------------------------------------------------------------
  const tabInfo = {
    'tab-batch': {
      title: 'Lưu Mã Hàng Loạt',
      desc: 'Dán danh sách mã voucher để tự động nhập vào ví Shopee'
    },
    'tab-zalo': {
      title: 'Zalo Auto-Sniffer (Tự Động Bắt Tin Nhắn & Link)',
      desc: 'Lắng nghe trực tiếp tin nhắn từ các nhóm Zalo săn sale và tự động lưu voucher'
    },
    'tab-scheduler': {
      title: 'Hẹn Giờ Săn Mã 0h',
      desc: 'Thiết lập thời gian mục tiêu chuẩn từng mili-giây cho các khung giờ vàng'
    },
    'tab-banner-watcher': {
      title: 'Canh Mã Back Banner (Dải Giờ Vàng & Canh Ngẫu Nhiên 24/7)',
      desc: 'Tự động rà soát API Shopee và chớp mã back ngẫu nhiên'
    },
    'tab-settings': {
      title: 'Cài ĐẶt Nâng Cao',
      desc: 'Tùy chỉnh tốc độ gửi request, độ trễ và các cấu hình hệ thống'
    }
  };

  function switchTab(tabId) {
    navItems.forEach(n => n.classList.remove('active'));
    tabPanels.forEach(p => p.classList.remove('active'));

    const activeNav = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    const activePanel = document.getElementById(tabId);

    if (activeNav && activePanel) {
      activeNav.classList.add('active');
      activePanel.classList.add('active');
      if (tabInfo[tabId]) {
        activeTabTitle.textContent = tabInfo[tabId].title;
        activeTabDesc.textContent = tabInfo[tabId].desc;
      }
      try {
        history.replaceState(null, '', '#' + tabId);
      } catch (e) {
        // Fallback in case of restricted environments
      }
      window.scrollTo({ top: 0, behavior: 'instant' });

      if (tabId === 'tab-zalo') {
        loadZaloStream();
      }
    }
  }

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(item.dataset.tab);
    });
  });

  if (window.location.hash) {
    const hash = window.location.hash.substring(1);
    if (tabInfo[hash]) {
      switchTab(hash);
    }
  }

  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.substring(1);
    if (tabInfo[hash]) {
      switchTab(hash);
    }
  });

  // -------------------------------------------------------------
  // 2. Authentication & Live Server Clock
  // -------------------------------------------------------------
  async function syncServerTime() {
    dashServerTime.textContent = 'Đang đồng bộ...';
    chrome.runtime.sendMessage({ type: 'GET_SERVER_TIME' }, res => {
      if (res && typeof res.offsetMs === 'number') {
        timeOffsetMs = res.offsetMs;
      }
    });
  }

  btnSyncTime.addEventListener('click', syncServerTime);

  function startClockLoop() {
    function tick() {
      const now = new Date(Date.now() + timeOffsetMs);
      const hours = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      const secs = String(now.getSeconds()).padStart(2, '0');
      const ms = String(now.getMilliseconds()).padStart(3, '0');

      dashServerTime.textContent = `${hours}:${mins}:${secs}`;
      dashServerMs.textContent = `.${ms}`;

      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  async function checkUserAccount() {
    userDisplayName.textContent = 'Đang kiểm tra...';
    if (userOnlineDot) {
      userOnlineDot.className = 'online-indicator';
    }

    chrome.runtime.sendMessage({ type: 'CHECK_LOGIN' }, res => {
      if (res && res.isLoggedIn) {
        userDisplayName.textContent = res.username || 'Người dùng Shopee';
        userAccountId.textContent = `ID: ${res.userId || 'Shopee VN'}`;
        if (userOnlineDot) {
          userOnlineDot.className = 'online-indicator online';
        }
        if (res.avatar) userAvatarImg.src = res.avatar;
      } else {
        userDisplayName.textContent = 'Chưa đăng nhập';
        userAccountId.textContent = 'Hãy đăng nhập shopee.vn';
        if (userOnlineDot) {
          userOnlineDot.className = 'online-indicator';
        }
      }
    });
  }

  btnRefreshUser.addEventListener('click', checkUserAccount);

  // -------------------------------------------------------------
  // 3. Tab 1: Batch Voucher Saver Logic
  // -------------------------------------------------------------
  batchInputCodes.addEventListener('input', () => {
    const parsed = extractVoucherCodes(batchInputCodes.value);
    batchDetectedCount.textContent = parsed.length;
    renderParsedTags(parsed);
  });

  function renderParsedTags(parsedList) {
    if (parsedList.length === 0) {
      parsedTagsContainer.innerHTML = '<span class="tag-placeholder">Các mã nhận diện sẽ hiển thị tại đây...</span>';
      return;
    }

    parsedTagsContainer.innerHTML = parsedList
      .slice(0, 30)
      .map(item => `<span class="code-tag">${item.code}</span>`)
      .join('');

    if (parsedList.length > 30) {
      parsedTagsContainer.innerHTML += `<span class="code-tag">+${parsedList.length - 30} mã khác</span>`;
    }
  }

  batchDelaySlider.addEventListener('input', () => {
    batchDelayValue.textContent = `${batchDelaySlider.value} ms`;
    chrome.storage.local.set({ batchDelay: batchDelaySlider.value });
  });

  btnClearBatch.addEventListener('click', () => {
    batchInputCodes.value = '';
    batchDetectedCount.textContent = '0';
    renderParsedTags([]);
    currentResults = [];
    renderResultsTable();
    updateStats(0, 0, 0);
    batchProgressBar.style.width = '0%';
    batchProgressLabel.textContent = 'Sẵn sàng thực hiện';
    batchProgressPercent.textContent = '0%';
  });

  btnRunBatch.addEventListener('click', () => {
    const parsed = extractVoucherCodes(batchInputCodes.value);
    if (parsed.length === 0) {
      alert('Vui lòng nhập ít nhất một mã voucher hợp lệ!');
      return;
    }

    const codes = parsed.map(p => p.code);
    currentResults = [];
    renderResultsTable();
    updateStats(codes.length, 0, 0);

    btnRunBatch.classList.add('hidden');
    btnStopBatch.classList.remove('hidden');

    chrome.runtime.sendMessage({
      type: 'START_BATCH_SAVE',
      payload: {
        codes,
        delayMs: Number(batchDelaySlider.value)
      }
    }, res => {
      btnRunBatch.classList.remove('hidden');
      btnStopBatch.classList.add('hidden');
      if (res && res.error) {
        alert(res.error);
      }
    });
  });

  btnStopBatch.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'STOP_BATCH_SAVE' });
    btnRunBatch.classList.remove('hidden');
    btnStopBatch.classList.add('hidden');
    batchProgressLabel.textContent = 'Đã dừng tiến trình!';
  });

  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeFilter = pill.dataset.filter;
      renderResultsTable();
    });
  });

  function updateStats(total, success, failed) {
    statTotal.textContent = total;
    statSuccess.textContent = success;
    statFailed.textContent = failed;
  }

  function renderResultsTable() {
    let filtered = currentResults;
    if (activeFilter === 'success') filtered = currentResults.filter(r => r.success);
    if (activeFilter === 'failed') filtered = currentResults.filter(r => !r.success);

    if (filtered.length === 0) {
      batchResultsTbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="5">Không có kết quả nào phù hợp với bộ lọc hiện tại.</td>
        </tr>
      `;
      return;
    }

    batchResultsTbody.innerHTML = filtered.map((item, idx) => {
      const timeStr = new Date(item.timestamp).toLocaleTimeString('vi-VN');
      return `
        <tr>
          <td>${idx + 1}</td>
          <td class="code-cell">${item.code}</td>
          <td>
            <span class="status-badge ${item.success ? 'success' : 'failed'}">
              ${item.success ? 'Thành công' : 'Thất bại'}
            </span>
          </td>
          <td>${item.message}</td>
          <td>${timeStr}</td>
        </tr>
      `;
    }).join('');
  }

  btnExportResults.addEventListener('click', () => {
    if (currentResults.length === 0) {
      alert('Chưa có dữ liệu kết quả để xuất!');
      return;
    }

    const headers = ['STT', 'Mã Voucher', 'Trạng Thái', 'Chi Tiết', 'Thời Gian'];
    const rows = currentResults.map((r, i) => [
      i + 1,
      r.code,
      r.success ? 'Thành công' : 'Thất bại',
      `"${(r.message || '').replace(/"/g, '""')}"`,
      new Date(r.timestamp).toLocaleString('vi-VN')
    ]);

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `shopee_voucher_results_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  // -------------------------------------------------------------
  // 4. Tab 2: Zalo Auto-Sniffer Logic
  // -------------------------------------------------------------
  async function initZaloSettings() {
    const {
      enableZaloSniffer = true,
      autoClaimZaloCodes = true,
      autoOpenZaloLinks = true,
      showZaloWidget = true,
      zaloTargetGroup = '[23] LONGHOUSEE'
    } = await chrome.storage.local.get(['enableZaloSniffer', 'autoClaimZaloCodes', 'autoOpenZaloLinks', 'showZaloWidget', 'zaloTargetGroup']);

    zaloEnableToggle.checked = enableZaloSniffer;
    zaloAutoclaimCodes.checked = autoClaimZaloCodes;
    zaloAutoopenLinks.checked = autoOpenZaloLinks;
    if (zaloShowWidgetToggle) {
      zaloShowWidgetToggle.checked = showZaloWidget !== false;
    }

    if (zaloTargetGroupInput) {
      zaloTargetGroupInput.value = zaloTargetGroup;
    }
    if (zaloActiveGroupLabel) {
      zaloActiveGroupLabel.textContent = zaloTargetGroup;
    }

    if (btnSaveZaloGroup && zaloTargetGroupInput) {
      btnSaveZaloGroup.addEventListener('click', async () => {
        const val = zaloTargetGroupInput.value.trim() || '[23] LONGHOUSEE';
        await chrome.storage.local.set({ zaloTargetGroup: val });
        if (zaloActiveGroupLabel) {
          zaloActiveGroupLabel.textContent = val;
        }
        btnSaveZaloGroup.textContent = 'Đã lưu!';
        setTimeout(() => {
          btnSaveZaloGroup.textContent = 'Lưu nhóm';
        }, 1800);
      });
    }

    zaloEnableToggle.addEventListener('change', () => {
      chrome.storage.local.set({ enableZaloSniffer: zaloEnableToggle.checked });
    });
    zaloAutoclaimCodes.addEventListener('change', () => {
      chrome.storage.local.set({ autoClaimZaloCodes: zaloAutoclaimCodes.checked });
    });
    zaloAutoopenLinks.addEventListener('change', () => {
      chrome.storage.local.set({ autoOpenZaloLinks: zaloAutoopenLinks.checked });
    });
    if (zaloShowWidgetToggle) {
      zaloShowWidgetToggle.addEventListener('change', () => {
        chrome.storage.local.set({ showZaloWidget: zaloShowWidgetToggle.checked });
      });
    }

    // Auto sync toggle if user closes widget using 'x' button inside Zalo
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.showZaloWidget && zaloShowWidgetToggle) {
        zaloShowWidgetToggle.checked = changes.showZaloWidget.newValue !== false;
      }
    });

    // Bot Node.js Daemon Controller
    initBotDaemonController();
  }

  function initBotDaemonController() {
    const btnToggleBot = document.getElementById('btn-toggle-bot');
    const btnSyncBotCookies = document.getElementById('btn-sync-bot-cookies');
    const botDot = document.getElementById('bot-dot');
    const botStatusText = document.getElementById('bot-status-text');

    let botIsOnline = false;
    let botIsRunning = false;

    async function checkBotStatus() {
      try {
        const res = await fetch('http://127.0.0.1:23232/status', { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          botIsOnline = true;
          botIsRunning = data.running;

          if (botDot) botDot.className = botIsRunning ? 'bot-dot online' : 'bot-dot paused';
          if (botStatusText) {
            botStatusText.innerHTML = botIsRunning
              ? `Bot Node.js đang chạy ngầm (Đã bắt: <strong>${data.stats?.messagesDetected || 0}</strong> tin, Lưu: <strong>${data.stats?.codesSaved || 0}</strong> mã)`
              : 'Bot Node.js đang tạm dừng';
          }
          if (btnToggleBot) {
            btnToggleBot.textContent = botIsRunning ? 'Tắt Chạy Ngầm' : 'Bật Chạy Ngầm';
            btnToggleBot.className = botIsRunning ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm';
          }
          return;
        }
      } catch (e) {
        // Bot is offline, check if background Zalo tab is running in Chrome
      }

      botIsOnline = false;
      chrome.runtime.sendMessage({ type: 'CHECK_ZALO_TAB' }, tabRes => {
        const hasTab = tabRes && tabRes.hasZaloTab;
        if (botDot) botDot.className = hasTab ? 'bot-dot online' : 'bot-dot offline';
        if (botStatusText) {
          botStatusText.innerHTML = hasTab
            ? 'Tab Zalo đang <strong>chạy ngầm trong Chrome</strong> (Đang theo dõi nhóm [23] LONGHOUSEE)'
            : 'Chế độ chạy ngầm đang TẮT. Bấm <strong>"Bật Chạy Ngầm"</strong> để tự động ghim tab Zalo ngầm.';
        }
        if (btnToggleBot) {
          btnToggleBot.textContent = hasTab ? 'Tắt Chạy Ngầm' : 'Bật Chạy Ngầm';
          btnToggleBot.className = hasTab ? 'btn btn-secondary btn-sm' : 'btn btn-primary btn-sm';
        }
      });
    }

    if (btnToggleBot) {
      btnToggleBot.addEventListener('click', async () => {
        // 1. If Bot Node.js is online, toggle it
        if (botIsOnline) {
          try {
            const res = await fetch('http://127.0.0.1:23232/toggle', { method: 'POST' });
            if (res.ok) {
              const data = await res.json();
              botIsRunning = data.running;
              checkBotStatus();
              return;
            }
          } catch (e) {}
        }

        // 2. Toggle Chrome Pinned Background Tab (Instant & already logged in!)
        chrome.runtime.sendMessage({ type: 'CHECK_ZALO_TAB' }, tabRes => {
          if (tabRes && tabRes.hasZaloTab) {
            chrome.runtime.sendMessage({ type: 'CLOSE_ZALO_TAB' }, () => {
              checkBotStatus();
            });
          } else {
            chrome.runtime.sendMessage({ type: 'ENSURE_ZALO_TAB' }, () => {
              checkBotStatus();
            });
          }
        });
      });
    }

    if (btnSyncBotCookies) {
      btnSyncBotCookies.addEventListener('click', async () => {
        btnSyncBotCookies.textContent = 'Đang đồng bộ...';
        try {
          // Get cookies via background.js (no CORS - background SW has full cookie access)
          const cookieData = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ type: 'GET_SHOPEE_COOKIES' }, res => {
              if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
              else resolve(res);
            });
          });
          const { spcU = '', spcEc = '', csrf = '' } = cookieData || {};

          const res = await fetch('http://127.0.0.1:23232/update_cookies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ SPC_U: spcU, SPC_EC: spcEc, csrftoken: csrf })
          });
          if (res.ok) {
            btnSyncBotCookies.textContent = 'Đã đồng bộ!';
            setTimeout(() => btnSyncBotCookies.textContent = 'Đồng Bộ Ví', 2000);
          } else {
            btnSyncBotCookies.textContent = 'Lỗi gửi Cookie';
            setTimeout(() => btnSyncBotCookies.textContent = 'Đồng Bộ Ví', 2000);
          }
        } catch (e) {
          btnSyncBotCookies.textContent = 'Bot chưa bật';
          setTimeout(() => btnSyncBotCookies.textContent = 'Đồng Bộ Ví', 2000);
        }
      });
    }

    // Store interval so it can be cleared if needed
    initBotDaemonController._intervalId = setInterval(checkBotStatus, 5000);
    checkBotStatus();
  }

  async function loadZaloStream() {
    const { zaloStream = [] } = await chrome.storage.local.get('zaloStream');
    renderZaloStream(zaloStream);
  }

  function renderZaloStream(stream) {
    if (stream.length === 0) {
      zaloStreamContainer.innerHTML = `
        <div class="empty-feed">
          <h4>Đang chờ tin nhắn mới từ nhóm Zalo mục tiêu...</h4>
          <p>Mở <a href="https://chat.zalo.me" target="_blank" style="color: #EE4D2D;">chat.zalo.me</a> trên trình duyệt. Mọi tin nhắn chứa mã hoặc link Shopee từ nhóm [23] LONGHOUSEE sẽ xuất hiện ngay tại đây!</p>
        </div>
      `;
      return;
    }

    zaloStreamContainer.innerHTML = stream.map(item => {
      const codeHtml = (item.codes || []).map(code => {
        const res = (item.results || []).find(r => r.code === code);
        const isSuccess = res ? res.success : false;
        const msg = res ? (res.message || (isSuccess ? 'Đã lưu' : 'Thất bại')) : 'Đang xử lý';
        const badgeClass = res ? (isSuccess ? 'success' : 'failed') : 'pending';
        return `
          <div class="feed-chip ${badgeClass}">
            <span class="chip-code">${code}</span>
            <span class="chip-status">${msg}</span>
          </div>
        `;
      }).join('');

      const linkHtml = (item.links || []).map(link => {
        let displayUrl = link;
        try {
          const u = new URL(link);
          displayUrl = u.hostname + u.pathname;
        } catch (e) {}
        return `
          <a href="${link}" target="_blank" class="feed-link-chip" title="${link}">
            Mở Link: ${displayUrl}
          </a>
        `;
      }).join('');

      return `
        <div class="zalo-msg-card">
          <div class="zalo-msg-header">
            <div class="zalo-msg-group">
              <span class="zalo-group-pill">${item.groupName || 'Nhóm Zalo'}</span>
              <span class="zalo-msg-sender">${item.senderName || 'Thành viên'}</span>
            </div>
            <span class="zalo-msg-time">${item.timeStr || ''}</span>
          </div>

          <div class="zalo-msg-text">${escapeHtml(item.text)}</div>

          ${codeHtml ? `
            <div class="feed-framed-box">
              <div class="feed-box-label">Mã voucher phát hiện:</div>
              <div class="feed-chips-wrap">${codeHtml}</div>
            </div>
          ` : ''}

          ${linkHtml ? `
            <div class="feed-framed-box mt-8">
              <div class="feed-box-label">Đường link săn mã:</div>
              <div class="feed-links-wrap">${linkHtml}</div>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  btnClearZaloFeed.addEventListener('click', async () => {
    if (confirm('Bạn có chắc chắn muốn xóa toàn bộ luồng tin Zalo không?')) {
      await chrome.storage.local.remove('zaloStream');
      loadZaloStream();
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
  }

  // -------------------------------------------------------------
  // 5. Tab 3: Scheduler (Hẹn giờ 0h)
  // -------------------------------------------------------------
  scheduleLeadTime.addEventListener('input', () => {
    leadTimeDisplay.textContent = `Sớm ${scheduleLeadTime.value} ms`;
  });

  presetTimeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetTimeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const hour = parseInt(btn.dataset.hour);
      const min = parseInt(btn.dataset.min);

      const target = new Date(Date.now() + timeOffsetMs);
      target.setHours(hour, min, 0, 0);

      if (target.getTime() <= Date.now() + timeOffsetMs) {
        target.setDate(target.getDate() + 1);
      }

      const year = target.getFullYear();
      const month = String(target.getMonth() + 1).padStart(2, '0');
      const day = String(target.getDate()).padStart(2, '0');
      const h = String(target.getHours()).padStart(2, '0');
      const m = String(target.getMinutes()).padStart(2, '0');
      const s = String(target.getSeconds()).padStart(2, '0');

      customScheduleTime.value = `${year}-${month}-${day}T${h}:${m}:${s}`;
    });
  });

  btnActivateSchedule.addEventListener('click', () => {
    if (!customScheduleTime.value) {
      alert('Vui lòng chọn thời gian hẹn giờ săn mã!');
      return;
    }

    const parsed = extractVoucherCodes(schedulerCodesInput.value);
    if (parsed.length === 0) {
      alert('Vui lòng nhập ít nhất 1 mã voucher để săn vào khung giờ này!');
      return;
    }

    const targetDate = new Date(customScheduleTime.value);
    const targetTimestamp = targetDate.getTime();

    if (targetTimestamp <= Date.now() + timeOffsetMs) {
      alert('Thời gian hẹn giờ phải ở tương lai!');
      return;
    }

    const leadTimeMs = parseInt(scheduleLeadTime.value) || 50;
    const codes = parsed.map(p => p.code);

    chrome.runtime.sendMessage({
      type: 'SCHEDULE_HUNT',
      payload: {
        targetTimestamp,
        leadTimeMs,
        codes,
        delayMs: Number(batchDelaySlider.value)
      }
    }, res => {
      if (res && res.success) {
        setSchedulerActive(targetTimestamp, codes);
      }
    });
  });

  btnCancelSchedule.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CANCEL_SCHEDULE' }, () => {
      setSchedulerInactive();
    });
  });

  function setSchedulerActive(timestamp, codes) {
    targetScheduleTimestamp = timestamp;
    countdownTargetText.textContent = `${new Date(timestamp).toLocaleString('vi-VN')} (${codes.length} mã)`;
    btnActivateSchedule.classList.add('hidden');
    btnCancelSchedule.classList.remove('hidden');
    countdownStatusBox.className = 'schedule-status-box active';
    scheduleStatusText.textContent = `Đang đếm ngược giờ G! Sẵn sàng bắn ${codes.length} mã`;

    if (countdownTimerId) clearInterval(countdownTimerId);
    countdownTimerId = setInterval(updateCountdown, 40);
  }

  function setSchedulerInactive() {
    targetScheduleTimestamp = 0;
    countdownTargetText.textContent = 'Chưa đặt lịch';
    btnActivateSchedule.classList.remove('hidden');
    btnCancelSchedule.classList.add('hidden');
    countdownStatusBox.className = 'schedule-status-box waiting';
    scheduleStatusText.textContent = 'Đang chờ bạn cấu hình lịch hẹn...';
    cdHours.textContent = '00';
    cdMins.textContent = '00';
    cdSecs.textContent = '00';
    cdMs.textContent = '000';

    if (countdownTimerId) {
      clearInterval(countdownTimerId);
      countdownTimerId = null;
    }
  }

  function updateCountdown() {
    if (!targetScheduleTimestamp) return;

    const now = Date.now() + timeOffsetMs;
    const diff = targetScheduleTimestamp - now;

    if (diff <= 0) {
      cdHours.textContent = '00';
      cdMins.textContent = '00';
      cdSecs.textContent = '00';
      cdMs.textContent = '000';
      scheduleStatusText.textContent = '🚀 ĐÃ KÍCH HOẠT SĂN MÃ!';
      setTimeout(setSchedulerInactive, 4000);
      return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const secs = Math.floor((diff % (1000 * 60)) / 1000);
    const ms = diff % 1000;

    cdHours.textContent = String(hours).padStart(2, '0');
    cdMins.textContent = String(mins).padStart(2, '0');
    cdSecs.textContent = String(secs).padStart(2, '0');
    cdMs.textContent = String(ms).padStart(3, '0');
  }

  chrome.storage.local.get('activeSchedule', ({ activeSchedule }) => {
    if (activeSchedule && activeSchedule.targetTimestamp > Date.now()) {
      setSchedulerActive(activeSchedule.targetTimestamp, activeSchedule.codes || []);
      if (activeSchedule.codes) {
        schedulerCodesInput.value = activeSchedule.codes.join('\n');
      }
    }
  });

  // -------------------------------------------------------------
  // 5.1 Tab: Banner Realtime Watcher (Canh Mã Back Ngẫu Nhiên)
  // -------------------------------------------------------------
  const bwInputUrl = document.getElementById('bw-input-url');
  const bwBtnCheckBanner = document.getElementById('bw-btn-check-banner');
  const labelModeWindow = document.getElementById('label-mode-window');
  const labelModeContinuous = document.getElementById('label-mode-continuous');
  const bwWindowOptions = document.getElementById('bw-window-options');
  const bwWindowHour = document.getElementById('bw-window-hour');
  const bwCustomTimeWrap = document.getElementById('bw-custom-time-wrap');
  const bwCustomTime = document.getElementById('bw-custom-time');
  const bwWindowDuration = document.getElementById('bw-window-duration');
  const bwPollInterval = document.getElementById('bw-poll-interval');
  const btnStartBannerWatch = document.getElementById('btn-start-banner-watch');
  const btnStopBannerWatch = document.getElementById('btn-stop-banner-watch');
  const bwLiveBadge = document.getElementById('bw-live-badge');
  const bwStatTotal = document.getElementById('bw-stat-total');
  const bwStatChecks = document.getElementById('bw-stat-checks');
  const bwStatSaved = document.getElementById('bw-stat-saved');
  const bwStatusBox = document.getElementById('bw-status-box');
  const bwStatusText = document.getElementById('bw-status-text');
  const bwBtnClearLogs = document.getElementById('bw-btn-clear-logs');
  const bwLogsContainer = document.getElementById('bw-logs-container');
  const wifiPingValue = document.getElementById('wifi-ping-value');
  const wifiQualityLabel = document.getElementById('wifi-quality-label');
  const wifiSampleCount = document.getElementById('wifi-sample-count');
  const wifiSpeedChart = document.getElementById('wifi-speed-chart');

  let selectedBwMode = 'WINDOW';
  const wifiSamples = [];
  let wifiMeasureTimer = null;

  function drawWifiChart() {
    if (!wifiSpeedChart) return;
    const context = wifiSpeedChart.getContext('2d');
    const width = wifiSpeedChart.clientWidth || 300;
    const height = 86;
    const ratio = window.devicePixelRatio || 1;
    wifiSpeedChart.width = width * ratio;
    wifiSpeedChart.height = height * ratio;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = '#F1D8D1';
    context.lineWidth = 1;
    [20, 43, 66].forEach(y => {
      context.beginPath();
      context.moveTo(0, y + 0.5);
      context.lineTo(width, y + 0.5);
      context.stroke();
    });
    if (wifiSamples.length < 2) return;
    const maxValue = Math.max(120, ...wifiSamples);
    const step = width / (wifiSamples.length - 1);
    context.beginPath();
    wifiSamples.forEach((sample, index) => {
      const x = index * step;
      const y = height - 8 - (Math.min(sample, maxValue) / maxValue) * (height - 18);
      index === 0 ? context.moveTo(x, y) : context.lineTo(x, y);
    });
    context.strokeStyle = '#EE4D2D';
    context.lineWidth = 2.5;
    context.stroke();
  }

  function getWifiQuality(ping) {
    if (ping < 80) return { label: 'Tốt - kết nối ổn định', color: '#26AA99' };
    if (ping < 180) return { label: 'Khá - có thể săn mã', color: '#D97706' };
    return { label: 'Yếu - nên kiểm tra Wi-Fi', color: '#DC2626' };
  }

  async function measureWifi() {
    if (!wifiPingValue) return;
    const startedAt = performance.now();
    try {
      await fetch(`https://shopee.vn/favicon.ico?wifi_probe=${Date.now()}`, {
        method: 'HEAD',
        cache: 'no-store'
      });
      const ping = Math.max(1, Math.round(performance.now() - startedAt));
      wifiSamples.push(ping);
      if (wifiSamples.length > 24) wifiSamples.shift();
      const quality = getWifiQuality(ping);
      wifiPingValue.textContent = ping;
      wifiQualityLabel.textContent = quality.label;
      wifiQualityLabel.style.color = quality.color;
      wifiSampleCount.textContent = `${wifiSamples.length} mẫu`;
      drawWifiChart();
    } catch (error) {
      wifiPingValue.textContent = '--';
      wifiQualityLabel.textContent = 'Không đo được kết nối';
      wifiQualityLabel.style.color = '#DC2626';
    }
  }

  function startWifiMonitor() {
    measureWifi();
    wifiMeasureTimer = setInterval(measureWifi, 10000);
  }

  window.addEventListener('resize', drawWifiChart);

  // Mode Selection
  if (labelModeWindow && labelModeContinuous) {
    labelModeWindow.addEventListener('click', () => {
      selectedBwMode = 'WINDOW';
      labelModeWindow.style.border = '2px solid #EE4D2D';
      labelModeWindow.style.background = '#FFFBF8';
      labelModeContinuous.style.border = '1px solid #E5E7EB';
      labelModeContinuous.style.background = '#fff';
      const radio = labelModeWindow.querySelector('input');
      if (radio) radio.checked = true;
      if (bwWindowOptions) bwWindowOptions.classList.remove('hidden');
    });

    labelModeContinuous.addEventListener('click', () => {
      selectedBwMode = 'CONTINUOUS';
      labelModeContinuous.style.border = '2px solid #EE4D2D';
      labelModeContinuous.style.background = '#FFFBF8';
      labelModeWindow.style.border = '1px solid #E5E7EB';
      labelModeWindow.style.background = '#fff';
      const radio = labelModeContinuous.querySelector('input');
      if (radio) radio.checked = true;
      if (bwWindowOptions) bwWindowOptions.classList.add('hidden');
    });
  }

  // Custom time dropdown toggle
  if (bwWindowHour && bwCustomTimeWrap) {
    bwWindowHour.addEventListener('change', () => {
      if (bwWindowHour.value === 'CUSTOM') {
        bwCustomTimeWrap.classList.remove('hidden');
      } else {
        bwCustomTimeWrap.classList.add('hidden');
      }
    });
  }

  function appendBannerLog(timeStr, text, level = 'info') {
    if (!bwLogsContainer) return;
    const color = level === 'success' ? '#34D399' : (level === 'warning' ? '#FBBF24' : (level === 'error' ? '#F87171' : '#9CA3AF'));
    const div = document.createElement('div');
    div.style.marginBottom = '4px';
    div.innerHTML = `<span style="color: #6B7280;">[${timeStr}]</span> <span style="color: ${color};">${escapeHtml(text)}</span>`;
    bwLogsContainer.appendChild(div);
    bwLogsContainer.scrollTop = bwLogsContainer.scrollHeight;
  }

  if (bwBtnClearLogs) {
    bwBtnClearLogs.addEventListener('click', () => {
      if (bwLogsContainer) {
        bwLogsContainer.innerHTML = '<div style="color: #6B7280;">[Hệ thống] Đã xóa lịch sử log quét API.</div>';
      }
    });
  }

  // Check Banner Info button
  if (bwBtnCheckBanner) {
    bwBtnCheckBanner.addEventListener('click', () => {
      const url = bwInputUrl?.value.trim() || 'https://shopee.vn/m/goi-ShopeeVIP';
      appendBannerLog(new Date().toLocaleTimeString('vi-VN'), `Đang kiểm tra cấu trúc voucher từ banner: ${url}...`, 'info');
      chrome.runtime.sendMessage({ type: 'FETCH_BANNER_INFO', payload: { url } }, res => {
        if (res && res.collections && res.collections.length > 0) {
          if (bwStatTotal) bwStatTotal.textContent = res.collections.length;
          appendBannerLog(new Date().toLocaleTimeString('vi-VN'), `✓ Kết nối thành công! Đã nạp ${res.collections.length} nguồn dữ liệu voucher từ banner [${res.slug}].`, 'success');
        } else {
          appendBannerLog(new Date().toLocaleTimeString('vi-VN'), `Không tìm thấy nguồn dữ liệu voucher nào (hoặc link không hợp lệ): ${res?.error || 'Lỗi kết nối'}`, 'warning');
        }
      });
    });
  }

  function calculateTargetTime() {
    const now = new Date(Date.now() + timeOffsetMs);
    const selected = bwWindowHour?.value || 'NEXT_SALE';

    if (selected === 'NEXT_SALE') {
      const saleHours = [0, 9, 12, 15, 18, 21];
      const currentHour = now.getHours();
      const currentMin = now.getMinutes();

      let targetH = saleHours.find(h => h > currentHour || (h === currentHour && currentMin < 5));
      const targetDate = new Date(now);
      if (targetH !== undefined) {
        targetDate.setHours(targetH, 0, 0, 0);
      } else {
        targetDate.setDate(targetDate.getDate() + 1);
        targetDate.setHours(0, 0, 0, 0);
      }
      return targetDate.getTime();
    }

    if (selected === 'CUSTOM') {
      const timeVal = bwCustomTime?.value;
      if (!timeVal) return Date.now();
      const [h, m, s = 0] = timeVal.split(':').map(Number);
      const targetDate = new Date(now);
      targetDate.setHours(h, m, s, 0);
      if (targetDate.getTime() <= now.getTime()) {
        targetDate.setDate(targetDate.getDate() + 1);
      }
      return targetDate.getTime();
    }

    const [h, m, s] = selected.split(':').map(Number);
    const targetDate = new Date(now);
    targetDate.setHours(h, m, s, 0);
    if (targetDate.getTime() <= now.getTime()) {
      targetDate.setDate(targetDate.getDate() + 1);
    }
    return targetDate.getTime();
  }

  function setBannerWatchActiveUI(state) {
    if (btnStartBannerWatch) btnStartBannerWatch.classList.add('hidden');
    if (btnStopBannerWatch) btnStopBannerWatch.classList.remove('hidden');
    if (bwLiveBadge) {
      bwLiveBadge.className = 'badge badge-success';
      bwLiveBadge.textContent = 'Đang Canh Mã';
    }
    if (bwStatusBox) {
      bwStatusBox.className = 'schedule-status-box active mb-16';
    }
    if (bwStatusText) {
      bwStatusText.textContent = state?.lastStatusText || 'Đang rà soát API Shopee liên tục...';
    }
    if (bwStatChecks && state?.checkCount != null) {
      bwStatChecks.textContent = state.checkCount;
    }
    if (bwStatSaved && state?.successCount != null) {
      bwStatSaved.textContent = state.successCount;
    }
    if (bwStatTotal && state?.collectionsCount != null) {
      bwStatTotal.textContent = state.collectionsCount;
    }
  }

  function setBannerWatchInactiveUI() {
    if (btnStartBannerWatch) btnStartBannerWatch.classList.remove('hidden');
    if (btnStopBannerWatch) btnStopBannerWatch.classList.add('hidden');
    if (bwLiveBadge) {
      bwLiveBadge.className = 'badge badge-secondary';
      bwLiveBadge.textContent = 'Đang Chờ';
    }
    if (bwStatusBox) {
      bwStatusBox.className = 'schedule-status-box waiting mb-16';
    }
    if (bwStatusText) {
      bwStatusText.textContent = 'Đang chờ bạn bấm "Bắt Đầu Canh Mã Back"...';
    }
  }

  if (btnStartBannerWatch) {
    btnStartBannerWatch.addEventListener('click', () => {
      const url = bwInputUrl?.value.trim() || 'https://shopee.vn/m/goi-ShopeeVIP';
      const intervalMs = Number(bwPollInterval?.value) || 3000;
      const windowDurationMins = Number(bwWindowDuration?.value) || 30;
      const targetTime = selectedBwMode === 'WINDOW' ? calculateTargetTime() : null;

      chrome.runtime.sendMessage({
        type: 'START_BANNER_WATCH',
        payload: {
          url,
          mode: selectedBwMode,
          intervalMs,
          targetTime,
          windowDurationMins
        }
      }, res => {
        if (res && res.success) {
          setBannerWatchActiveUI(res.state);
        }
      });
    });
  }

  if (btnStopBannerWatch) {
    btnStopBannerWatch.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'STOP_BANNER_WATCH' }, () => {
        setBannerWatchInactiveUI();
      });
    });
  }

  // Check initial state from background
  chrome.runtime.sendMessage({ type: 'GET_BANNER_WATCH_STATUS' }, state => {
    if (state && state.isRunning) {
      setBannerWatchActiveUI(state);
    }
  });

  // -------------------------------------------------------------
  // -------------------------------------------------------------
  // 6. Settings & Lamplit Theme Logic
  // -------------------------------------------------------------
  function applyTheme(themeName) {
    const validThemes = ['classic', 'tokyonight', 'catppuccin', 'wonderland', 'bigwave', 'bauhaus'];
    const theme = validThemes.includes(themeName) ? themeName : 'tokyonight';
    document.documentElement.setAttribute('data-theme', theme);
    if (themeSelector) themeSelector.value = theme;
    if (settingTheme) settingTheme.value = theme;
  }

  async function handleThemeChange(newTheme) {
    applyTheme(newTheme);
    try {
      localStorage.setItem('dashboardTheme', newTheme);
      await chrome.storage.local.set({ dashboardTheme: newTheme });
    } catch (e) {
      console.warn('Could not save theme:', e);
    }
  }

  if (themeSelector) {
    themeSelector.addEventListener('change', (e) => handleThemeChange(e.target.value));
  }
  if (settingTheme) {
    settingTheme.addEventListener('change', (e) => handleThemeChange(e.target.value));
  }

  async function loadSettings() {
    const {
      batchDelay = '1800',
      settingSoundVal = true,
      settingFloatingWidgetVal = true,
      dashboardTheme = localStorage.getItem('dashboardTheme') || 'tokyonight'
    } = await chrome.storage.local.get(['batchDelay', 'settingSoundVal', 'settingFloatingWidgetVal', 'dashboardTheme']);

    applyTheme(dashboardTheme);

    settingDefaultDelay.value = batchDelay;
    batchDelaySlider.value = batchDelay;
    batchDelayValue.textContent = `${batchDelay} ms`;
    settingSound.checked = settingSoundVal;
    settingFloatingWidget.checked = settingFloatingWidgetVal;

    window.__cachedSettings = { settingSoundVal, settingFloatingWidgetVal };
  }

  btnSaveSettings.addEventListener('click', async () => {
    const batchDelay = settingDefaultDelay.value;
    const settingSoundVal = settingSound.checked;
    const settingFloatingWidgetVal = settingFloatingWidget.checked;
    const currentTheme = settingTheme ? settingTheme.value : 'tokyonight';

    await chrome.storage.local.set({
      batchDelay,
      settingSoundVal,
      settingFloatingWidgetVal,
      dashboardTheme: currentTheme
    });
    localStorage.setItem('dashboardTheme', currentTheme);
    applyTheme(currentTheme);

    window.__cachedSettings = { settingSoundVal, settingFloatingWidgetVal };
    batchDelaySlider.value = batchDelay;
    batchDelayValue.textContent = `${batchDelay} ms`;

    settingsSaveMsg.classList.remove('hidden');
    setTimeout(() => settingsSaveMsg.classList.add('hidden'), 3000);
  });

  // -------------------------------------------------------------
  // 9. Runtime Background Message Listeners
  // -------------------------------------------------------------
  chrome.runtime.onMessage.addListener(msg => {
    if (msg.type === 'BATCH_STARTED') {
      btnRunBatch.classList.add('hidden');
      btnStopBatch.classList.remove('hidden');
      batchProgressBar.style.width = '0%';
      batchProgressLabel.textContent = `Bắt đầu lưu ${msg.total} mã...`;
      batchProgressPercent.textContent = '0%';
    }

    if (msg.type === 'BATCH_PROGRESS') {
      const pct = Math.round((msg.current / msg.total) * 100);
      batchProgressBar.style.width = `${pct}%`;
      batchProgressPercent.textContent = `${pct}%`;
      batchProgressLabel.textContent = `Đang lưu (${msg.current}/${msg.total}): ${msg.currentCode}`;
    }

    if (msg.type === 'VOUCHER_RESULT') {
      currentResults.unshift(msg.result);
      const successes = currentResults.filter(r => r.success).length;
      const fails = currentResults.length - successes;
      updateStats(msg.total, successes, fails);
      renderResultsTable();

      if (msg.result.success) {
        playSuccessChime();
      }
    }

    if (msg.type === 'BATCH_COMPLETED') {
      btnRunBatch.classList.remove('hidden');
      btnStopBatch.classList.add('hidden');
      batchProgressBar.style.width = '100%';
      batchProgressPercent.textContent = '100%';
      batchProgressLabel.textContent = `Hoàn thành lưu mã! (Thành công: ${msg.summary.successCount}/${msg.summary.total})`;
    }

    if (msg.type === 'ZALO_STREAM_UPDATE') {
      renderZaloStream(msg.stream || []);
    }

    if (msg.type === 'BANNER_WATCH_LOG') {
      appendBannerLog(msg.entry.time, msg.entry.text, msg.entry.level);
      if (bwStatChecks && msg.state?.checkCount != null) bwStatChecks.textContent = msg.state.checkCount;
      if (bwStatSaved && msg.state?.successCount != null) bwStatSaved.textContent = msg.state.successCount;
      if (bwStatTotal && msg.state?.collectionsCount != null) bwStatTotal.textContent = msg.state.collectionsCount;
      if (bwStatusText && msg.entry?.text) bwStatusText.textContent = msg.entry.text;
    }

    if (msg.type === 'BANNER_WATCH_STATUS') {
      if (msg.state?.isRunning) {
        setBannerWatchActiveUI(msg.state);
      } else {
        setBannerWatchInactiveUI();
      }
    }

    if (msg.type === 'BANNER_VOUCHER_SAVED') {
      playSuccessChime();
      appendBannerLog(new Date().toLocaleTimeString('vi-VN'), `🎉 [LƯU THÀNH CÔNG] Đã lưu vào ví: ${msg.voucher?.title || ''}`, 'success');
    }
  });

  // Initializations
  await loadSettings();
  await initZaloSettings();
  await checkUserAccount();
  await syncServerTime();
  startClockLoop();
  startWifiMonitor();
});
