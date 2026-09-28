// Built by Arnab Mandal — contact: hello@arnabmandal.com

let allReports = [];
let filteredReports = [];
let currentFilter = 'all';

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadReports();
  setupEventListeners();
  filterReports(); // Apply initial filter
});

function setupEventListeners() {
  // Search
  document.getElementById('searchBar').addEventListener('input', (e) => {
    filterReports();
  });
  
  // Filter tabs
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      filterReports();
    });
  });
  
  // Export buttons
  document.getElementById('exportAllHtml').addEventListener('click', exportAllAsHtml);
  document.getElementById('exportAllJson').addEventListener('click', exportAllAsJson);
  document.getElementById('clearAllReports').addEventListener('click', clearAllReports);
  
  // Navigation buttons
  document.getElementById('navBatch')?.addEventListener('click', () => location.href = 'batch.html');
  document.getElementById('navTasks')?.addEventListener('click', () => location.href = 'tasks.html');
  document.getElementById('navAnalytics')?.addEventListener('click', () => location.href = 'analytics.html');
  document.getElementById('navSettings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
}

async function loadReports() {
  const data = await chrome.storage.local.get(null);
  allReports = [];
  
  // Load batch results
  if (data['batch::queue']) {
    const queue = data['batch::queue'];
    if (queue.urls && Array.isArray(queue.urls)) {
      queue.urls.forEach((item, index) => {
        if (item.status === 'completed' && item.result) {
          allReports.push({
            type: 'batch',
            url: item.url,
            result: item.result,
            screenshot: item.screenshot,
            timestamp: queue.timestamp || Date.now(),
            index: index
          });
        }
      });
    }
  }
  
  // Load single URL analyses
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('analysis::') && value) {
      allReports.push({
        type: 'single',
        url: key.replace('analysis::', ''),
        result: value,
        timestamp: value.timestamp || Date.now()
      });
    }
  }
  
  // Sort by timestamp descending
  allReports.sort((a, b) => b.timestamp - a.timestamp);
  
  updateStats();
}

function updateStats() {
  let low = 0, medium = 0, high = 0;
  
  allReports.forEach(report => {
    const score = report.result?.ai?.scamometer;
    if (typeof score !== 'number') return;
    if (score < 30) low++;
    else if (score < 70) medium++;
    else high++;
  });
  
  document.getElementById('totalReports').textContent = allReports.length;
  document.getElementById('lowRiskCount').textContent = low;
  document.getElementById('mediumRiskCount').textContent = medium;
  document.getElementById('highRiskCount').textContent = high;
}

// Pagination variables
let currentPage = 1;
const itemsPerPage = 20;

// Sorting variable
let currentSort = 'date-desc';

function filterReports() {
  const searchTerm = document.getElementById('searchBar').value.toLowerCase();
  
  filteredReports = allReports.filter(report => {
    // Search filter
    if (searchTerm && !report.url.toLowerCase().includes(searchTerm)) {
      return false;
    }
    
    // Type filter
    if (currentFilter === 'batch' && report.type !== 'batch') return false;
    if (currentFilter === 'single' && report.type !== 'single') return false;
    
    // Risk filter
    const score = report.result?.ai?.scamometer;
    if (typeof score !== 'number') return !['low', 'medium', 'high'].includes(currentFilter);
    if (currentFilter === 'low' && score >= 30) return false;
    if (currentFilter === 'medium' && (score < 30 || score >= 70)) return false;
    if (currentFilter === 'high' && score < 70) return false;
    
    return true;
  });
  
  renderReports();
}

function renderReports() {
  const grid = document.getElementById('resultsGrid');
  const empty = document.getElementById('emptyState');
  
  if (filteredReports.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  
  empty.style.display = 'none';
  
  // Simple clean UI: Just URL and score with gradient
  grid.innerHTML = filteredReports.map((report, index) => {
    const score = report.result?.ai?.scamometer;
    const riskLevel = typeof score !== 'number' ? 'unknown' : score < 30 ? 'low' : score < 70 ? 'medium' : 'high';
    
    // Calculate gradient based on score (green to yellow to red)
    let gradientColor;
    if (typeof score !== "number") {
      gradientColor = `linear-gradient(90deg, rgba(100,116,139,.3), rgba(100,116,139,.1))`;
    } else if (score < 30) {
      // Green for low risk
      gradientColor = `linear-gradient(90deg, rgba(22, 163, 74, 0.3), rgba(22, 163, 74, 0.1))`;
    } else if (score < 70) {
      // Yellow for medium risk
      gradientColor = `linear-gradient(90deg, rgba(234, 179, 8, 0.3), rgba(234, 179, 8, 0.1))`;
    } else {
      // Red for high risk
      gradientColor = `linear-gradient(90deg, rgba(220, 38, 38, 0.3), rgba(220, 38, 38, 0.1))`;
    }
    
    return `
      <div class="result-card" style="background: ${gradientColor}; border-left: 4px solid ${riskLevel === 'low' ? 'var(--green)' : riskLevel === 'medium' ? 'var(--yellow)' : riskLevel === 'unknown' ? '#64748b' : 'var(--red)'};">
        <div class="result-header">
          <div class="result-url">${escapeHtml(report.url)}</div>
          <div class="score-badge ${riskLevel}">${typeof score === 'number' ? `${Math.round(score)}/100` : 'Unavailable'}</div>
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

window.viewReport = function(index) {
  const report = filteredReports[index];
  if (!report) return;
  
  // Create a new window with detailed view
  const detailWindow = window.open('', '_blank', 'width=900,height=700');
  detailWindow.document.write(generateDetailedView(report));
};

window.downloadHtml = async function(index) {
  const report = filteredReports[index];
  if (!report) return;
  
  const html = generateDetailedView(report);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  
  try {
    const hostname = new URL(report.url).hostname.replace(/\./g, '_');
    await chrome.downloads.download({
      url: url,
      filename: `scamometer_reports/report_${hostname}_${Date.now()}.html`,
      saveAs: false
    });
    showToast('Report downloaded to scamometer_reports folder');
  } catch (err) {
    console.error('Download error:', err);
    // Fallback
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${Date.now()}.html`;
    a.click();
    showToast('Report downloaded');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 100);
  }
};

window.downloadJson = function(index) {
  const report = filteredReports[index];
  if (!report) return;
  
  const json = JSON.stringify(report, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const hostname = new URL(report.url).hostname.replace(/\./g, '_');
  a.download = `report_${hostname}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('JSON downloaded');
};

window.deleteReport = async function(index) {
  const report = filteredReports[index];
  if (!report) return;
  
  if (!confirm(`Delete report for ${report.url}?`)) return;
  
  // Delete from storage
  if (report.type === 'batch') {
    // Remove from batch queue
    const data = await chrome.storage.local.get('batch::queue');
    if (data['batch::queue']) {
      const queue = data['batch::queue'];
      if (queue.urls && queue.urls[report.index]) {
        queue.urls.splice(report.index, 1);
        await chrome.storage.local.set({ 'batch::queue': queue });
      }
    }
  } else {
    // Remove single analysis
    await chrome.storage.local.remove(`analysis::${report.url}`);
  }
  
  showToast('Report deleted');
  await loadReports();
  filterReports();
};

function showToast(message, isError = false) {
  // Simple toast notification
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: ${isError ? '#dc2626' : '#16a34a'};
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    z-index: 10000;
    animation: slideIn 0.3s ease;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function generateDetailedView(report) {
  const score = report.result?.ai?.scamometer ?? report.result?.score ?? null;
  const riskLevel = typeof score !== 'number' ? 'unknown' : score < 30 ? 'low' : score < 70 ? 'medium' : 'high';
  const verdict = report.result?.ai?.verdict || report.result?.verdict || 'Unknown';
  const reason = report.result?.ai?.reason || report.result?.reason || 'No reason provided';
  const positives = report.result?.ai?.positives || report.result?.positiveIndicators || [];
  const negatives = report.result?.ai?.negatives || report.result?.redFlags || [];
  const date = new Date(report.timestamp).toLocaleString();
  
  let screenshotHtml = '';
  if (report.screenshot && report.screenshot.dataUrl) {
    screenshotHtml = `
      <div style="margin-top: 24px;">
        <h2 style="color: #06b6d4; margin-bottom: 12px;">📸 Screenshot</h2>
        <img src="${escapeHtml(report.screenshot.dataUrl)}" style="max-width: 100%; border: 1px solid #1f2937; border-radius: 8px;">
      </div>
    `;
  } else if (report.screenshot && report.screenshot.filename) {
    screenshotHtml = `
      <div style="margin-top: 24px;">
        <h2 style="color: #06b6d4; margin-bottom: 12px;">📸 Screenshot</h2>
        <img src="./${escapeHtml(report.screenshot.filename)}" style="max-width: 100%; border: 1px solid #1f2937; border-radius: 8px;"
             onerror="this.parentElement.innerHTML='<p style=\\'padding:20px;text-align:center;color:#999;\\'>Screenshot not found.</p>'">
        <p style="color: #94a3b8; font-size: 12px; margin-top: 8px;">Note: Screenshot uses relative path. Make sure this window was opened from the reports dashboard.</p>
      </div>
    `;
  }
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Report Details - ${escapeHtml(report.url)}</title>
      <style>
        body {
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, sans-serif;
          background: #0b1020;
          color: #e2e8f0;
          padding: 32px;
          max-width: 1000px;
          margin: 0 auto;
        }
        h1 { font-size: 28px; margin-bottom: 8px; }
        h2 { font-size: 20px; color: #06b6d4; margin-top: 24px; margin-bottom: 12px; }
        .meta { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
        .score-big {
          display: inline-block;
          font-size: 48px;
          font-weight: 700;
          padding: 24px 48px;
          border-radius: 16px;
          margin: 24px 0;
        }
        .score-big.low { background: rgba(22, 163, 74, 0.2); color: #16a34a; border: 2px solid #16a34a; }
        .score-big.medium { background: rgba(234, 179, 8, 0.2); color: #eab308; border: 2px solid #eab308; }
        .score-big.high { background: rgba(220, 38, 38, 0.2); color: #dc2626; border: 2px solid #dc2626; }
        .verdict { font-size: 24px; font-weight: 600; margin-bottom: 12px; }
        .reason { color: #94a3b8; line-height: 1.6; }
        .tag {
          display: inline-block;
          padding: 6px 12px;
          border-radius: 999px;
          font-size: 13px;
          margin: 4px;
          border: 1px solid;
        }
        .tag.positive { background: rgba(22, 163, 74, 0.1); color: #16a34a; border-color: #16a34a; }
        .tag.negative { background: rgba(220, 38, 38, 0.1); color: #dc2626; border-color: #dc2626; }
        .tags { margin-top: 12px; }
        button {
          padding: 10px 20px;
          border-radius: 10px;
          border: 1px solid #1f2937;
          background: #0f172a;
          color: #e2e8f0;
          cursor: pointer;
          font-weight: 600;
          font-size: 14px;
          margin-right: 8px;
        }
        button:hover { border-color: #06b6d4; background: rgba(6, 182, 212, 0.1); }
      </style>
    </head>
    <body>
      <button onclick="window.close()">✕ Close</button>
      
      <h1>${escapeHtml(report.url)}</h1>
      <div class="meta">Analyzed on ${date} • Type: ${report.type === 'batch' ? 'Batch Processing' : 'Single Scan'}</div>
      
      <div class="score-big ${riskLevel}">${score === null ? 'Unavailable' : `${score} / 100`}</div>
      
      <div class="verdict">${escapeHtml(verdict)}</div>
      <div class="reason">${escapeHtml(reason)}</div>
      
      <h2>✅ Positive Indicators</h2>
      <div class="tags">
        ${positives.length > 0 ? positives.map(p => `<span class="tag positive">${escapeHtml(p)}</span>`).join('') : '<span style="color: #94a3b8;">None found</span>'}
      </div>
      
      <h2>🚩 Red Flags</h2>
      <div class="tags">
        ${negatives.length > 0 ? negatives.map(n => `<span class="tag negative">${escapeHtml(n)}</span>`).join('') : '<span style="color: #94a3b8;">None found</span>'}
      </div>
      
      ${screenshotHtml}
    </body>
    </html>
  `;
}

window.downloadHtml = async function(index) {
  const report = filteredReports[index];
  if (!report) return;
  
  const html = await generateDownloadableHtml(report);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  
  const hostname = new URL(report.url).hostname.replace(/[^a-z0-9]/gi, '_');
  const filename = `scamometer_${hostname}_${Date.now()}.html`;
  
  // Try to download to scamometer_reports folder using chrome.downloads API
  try {
    await chrome.downloads.download({
      url: url,
      filename: `scamometer_reports/${filename}`,
      saveAs: false
    });
    URL.revokeObjectURL(url);
  } catch (error) {
    // Fallback to regular download
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
};

async function generateDownloadableHtml(report) {
  const score = report.result?.ai?.scamometer ?? report.result?.score ?? null;
  const riskLevel = typeof score !== 'number' ? 'unknown' : score < 30 ? 'low' : score < 70 ? 'medium' : 'high';
  const riskColor = riskLevel === 'unknown' ? '#64748b' : riskLevel === 'low' ? '#16a34a' : riskLevel === 'medium' ? '#eab308' : '#dc2626';
  const verdict = report.result?.ai?.verdict || report.result?.verdict || 'Unknown';
  const reason = report.result?.ai?.reason || report.result?.reason || 'No reason provided';
  const positives = report.result?.ai?.positives || report.result?.positiveIndicators || [];
  const negatives = report.result?.ai?.negatives || report.result?.redFlags || [];
  const date = new Date(report.timestamp).toLocaleString();
  
  // Use relative path for screenshot if available
  let screenshotHtml = '';
  if (report.screenshot && report.screenshot.filename) {
    screenshotHtml = `
      <div class="section">
        <h2>📸 Screenshot</h2>
        <div class="screenshot-container">
          <img src="./${escapeHtml(report.screenshot.filename)}" alt="Page Screenshot" class="screenshot"
               onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
          <div class="screenshot-error" style="display:none;">
            Screenshot file not found. Make sure this HTML file is in the same folder as the screenshots.
          </div>
          <button class="btn" onclick="this.previousElementSibling.previousElementSibling.style.display = this.previousElementSibling.previousElementSibling.style.display === 'none' ? 'block' : 'none'">
            👁️ Toggle Screenshot
          </button>
        </div>
      </div>
    `;
  }
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scamometer Report - ${escapeHtml(new URL(report.url).hostname)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      background: #0b1020;
      color: #e2e8f0;
      padding: 40px 20px;
      line-height: 1.6;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
      background: #0f172a;
      border-radius: 16px;
      padding: 40px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    }
    header {
      border-bottom: 2px solid #1f2937;
      padding-bottom: 24px;
      margin-bottom: 32px;
    }
    h1 {
      font-size: 32px;
      margin-bottom: 12px;
      word-break: break-all;
    }
    .meta {
      color: #94a3b8;
      font-size: 14px;
    }
    .score-section {
      background: linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(6, 182, 212, 0.05));
      border: 2px solid ${riskColor};
      border-radius: 16px;
      padding: 32px;
      text-align: center;
      margin: 32px 0;
    }
    .score-big {
      font-size: 72px;
      font-weight: 700;
      color: ${riskColor};
      margin-bottom: 16px;
    }
    .verdict {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 12px;
    }
    .reason {
      color: #94a3b8;
      font-size: 16px;
    }
    .section {
      margin: 32px 0;
    }
    h2 {
      font-size: 24px;
      color: #06b6d4;
      margin-bottom: 16px;
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .tag {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 999px;
      font-size: 14px;
      font-weight: 500;
      border: 1px solid;
    }
    .tag.positive {
      background: rgba(22, 163, 74, 0.15);
      color: #16a34a;
      border-color: #16a34a;
    }
    .tag.negative {
      background: rgba(220, 38, 38, 0.15);
      color: #dc2626;
      border-color: #dc2626;
    }
    .screenshot {
      max-width: 100%;
      border: 1px solid #1f2937;
      border-radius: 12px;
      margin-top: 16px;
      display: block;
    }
    .screenshot-container {
      position: relative;
    }
    .screenshot-error {
      padding: 16px;
      background: rgba(220, 38, 38, 0.1);
      border: 1px solid #dc2626;
      border-radius: 8px;
      color: #dc2626;
      margin-top: 16px;
    }
    .btn {
      padding: 10px 20px;
      border-radius: 10px;
      border: 1px solid #1f2937;
      background: #0b1020;
      color: #e2e8f0;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      margin-top: 12px;
    }
    .btn:hover {
      border-color: #06b6d4;
      background: rgba(6, 182, 212, 0.1);
    }
    .export-btns {
      display: flex;
      gap: 12px;
      margin-top: 32px;
      padding-top: 32px;
      border-top: 2px solid #1f2937;
    }
    footer {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 2px solid #1f2937;
      text-align: center;
      color: #94a3b8;
      font-size: 13px;
    }
    @media print {
      body { background: white; color: black; }
      .container { box-shadow: none; }
      .btn, .export-btns { display: none; }
    }
  </style>
</head>
<body>
  <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 12px 20px; text-align: center; font-size: 13px; font-weight: 500; margin-bottom: 20px;">
    💡 <strong>Note:</strong> This report is automatically saved to <strong>Downloads/scamometer_reports/</strong> with screenshots. Open it from that folder to view images.
  </div>
  
  <div class="container">
    <header>
      <h1>${escapeHtml(report.url)}</h1>
      <div class="meta">Report Generated: ${date} | Source: Scamometer v4.1</div>
    </header>
    
    <div class="score-section">
      <div class="score-big">${score === null ? 'Unavailable' : `${score}/100`}</div>
      <div class="verdict">${escapeHtml(verdict)}</div>
      <div class="reason">${escapeHtml(reason)}</div>
    </div>
    
    <div class="section">
      <h2>✅ Positive Indicators</h2>
      <div class="tags">
        ${positives.length > 0 ? positives.map(p => `<span class="tag positive">${escapeHtml(p)}</span>`).join('') : '<span style="color: #94a3b8;">None found</span>'}
      </div>
    </div>
    
    <div class="section">
      <h2>🚩 Red Flags</h2>
      <div class="tags">
        ${negatives.length > 0 ? negatives.map(n => `<span class="tag negative">${escapeHtml(n)}</span>`).join('') : '<span style="color: #94a3b8;">None found</span>'}
      </div>
    </div>
    
    ${screenshotHtml}
    
    <div class="export-btns">
      <button class="btn" onclick="exportAsJson()">📥 Export as JSON</button>
      <button class="btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
    </div>
    
    <footer>
      Generated by <strong>Scamometer</strong> Chrome Extension<br>
      Built by Arnab Mandal — <a href="https://github.com/vio137/scamometer" style="color: #06b6d4;">GitHub</a>
    </footer>
  </div>
  
  <script>
    const reportData = ${JSON.stringify(report.result)};
    
    function exportAsJson() {
      const dataStr = JSON.stringify(reportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'scamometer_report_' + Date.now() + '.json';
      a.click();
      URL.revokeObjectURL(url);
    }
  </script>
</body>
</html>
  `;
}

window.downloadJson = function(index) {
  const report = filteredReports[index];
  if (!report) return;
  
  const data = {
    url: report.url,
    type: report.type,
    timestamp: report.timestamp,
    result: report.result,
    screenshot: report.screenshot
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  
  const hostname = new URL(report.url).hostname.replace(/[^a-z0-9]/gi, '_');
  a.download = `scamometer_${hostname}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

window.deleteReport = async function(index) {
  const report = filteredReports[index];
  if (!report) return;
  
  if (!confirm(`Delete report for ${report.url}?`)) return;
  
  if (report.type === 'single') {
    await chrome.storage.local.remove(`analysis::${report.url}`);
  } else if (report.type === 'batch') {
    // Remove from batch queue
    const { 'batch::queue': queue } = await chrome.storage.local.get('batch::queue');
    if (queue && queue.urls) {
      queue.urls.splice(report.index, 1);
      await chrome.storage.local.set({ 'batch::queue': queue });
    }
  }
  
  await loadReports();
  filterReports();
};

async function exportAllAsHtml() {
  if (allReports.length === 0) {
    alert('No reports to export');
    return;
  }
  
  const html = await generateBulkHtml(allReports);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scamometer_all_reports_${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

async function generateBulkHtml(reports) {
  const date = new Date().toLocaleString();
  let low = 0, medium = 0, high = 0;
  
  reports.forEach(report => {
    const score = report.result?.ai?.scamometer ?? report.result?.score ?? null;
    if (typeof score !== "number") return;
    if (score < 30) low++;
    else if (score < 70) medium++;
    else high++;
  });
  
  const reportsHtml = reports.map((report, index) => {
    const score = report.result?.ai?.scamometer ?? report.result?.score ?? null;
    const riskLevel = typeof score !== 'number' ? 'unknown' : score < 30 ? 'low' : score < 70 ? 'medium' : 'high';
    const riskColor = riskLevel === 'unknown' ? '#64748b' : riskLevel === 'low' ? '#16a34a' : riskLevel === 'medium' ? '#eab308' : '#dc2626';
    const verdict = report.result?.ai?.verdict || report.result?.verdict || 'Unknown';
    const positives = report.result?.ai?.positives || report.result?.positiveIndicators || [];
    const negatives = report.result?.ai?.negatives || report.result?.redFlags || [];
    
    return `
      <div class="report-card">
        <div class="report-header">
          <h3>${escapeHtml(report.url)}</h3>
          <div class="score-badge" style="background: ${riskColor};">${score === null ? 'Unavailable' : `${score}/100`}</div>
        </div>
        <div class="report-verdict">${escapeHtml(verdict)}</div>
        <div class="report-meta">${new Date(report.timestamp).toLocaleString()} • ${report.type === 'batch' ? 'Batch' : 'Single'}</div>
        <div class="tags-row">
          <div>
            <strong>✅ Positives:</strong> ${positives.length > 0 ? positives.map(p => `<span class="tag positive">${escapeHtml(p)}</span>`).join('') : 'None'}
          </div>
          <div>
            <strong>🚩 Red Flags:</strong> ${negatives.length > 0 ? negatives.map(n => `<span class="tag negative">${escapeHtml(n)}</span>`).join('') : 'None'}
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Scamometer - All Reports</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ui-sans-serif, system-ui, sans-serif;
      background: #0b1020;
      color: #e2e8f0;
      padding: 40px 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      text-align: center;
      margin-bottom: 48px;
      padding-bottom: 32px;
      border-bottom: 2px solid #1f2937;
    }
    h1 { font-size: 42px; margin-bottom: 12px; }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin: 32px 0;
    }
    .stat-card {
      background: #0f172a;
      border: 1px solid #1f2937;
      border-radius: 12px;
      padding: 24px;
      text-align: center;
    }
    .stat-value { font-size: 48px; font-weight: 700; margin-bottom: 8px; }
    .stat-label { font-size: 12px; color: #94a3b8; text-transform: uppercase; }
    .report-card {
      background: #0f172a;
      border: 1px solid #1f2937;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 16px;
    }
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 12px;
    }
    h3 { font-size: 18px; word-break: break-all; flex: 1; margin-right: 16px; }
    .score-badge {
      padding: 8px 16px;
      border-radius: 999px;
      color: white;
      font-weight: 700;
      font-size: 16px;
    }
    .report-verdict { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
    .report-meta { font-size: 13px; color: #94a3b8; margin-bottom: 12px; }
    .tags-row { font-size: 13px; line-height: 1.8; }
    .tag {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      margin: 2px;
      font-size: 12px;
    }
    .tag.positive { background: rgba(22, 163, 74, 0.15); color: #16a34a; }
    .tag.negative { background: rgba(220, 38, 38, 0.15); color: #dc2626; }
    .export-btn {
      padding: 12px 24px;
      border-radius: 10px;
      border: 1px solid #1f2937;
      background: #0f172a;
      color: #e2e8f0;
      cursor: pointer;
      font-weight: 600;
      margin-top: 32px;
    }
    .export-btn:hover { border-color: #06b6d4; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📊 Scamometer - All Reports</h1>
      <div style="color: #94a3b8;">Generated: ${date}</div>
    </header>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value" style="color: #06b6d4;">${reports.length}</div>
        <div class="stat-label">Total Reports</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #16a34a;">${low}</div>
        <div class="stat-label">Low Risk</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #eab308;">${medium}</div>
        <div class="stat-label">Medium Risk</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #dc2626;">${high}</div>
        <div class="stat-label">High Risk</div>
      </div>
    </div>
    
    <button class="export-btn" onclick="exportAsJson()">📥 Export All as JSON</button>
    
    <div style="margin-top: 32px;">
      ${reportsHtml}
    </div>
    
    <div style="text-align: center; margin-top: 48px; color: #94a3b8; font-size: 13px;">
      Generated by Scamometer v3.0 — Built by Arnab Mandal
    </div>
  </div>
  
  <script>
    const allData = ${JSON.stringify(reports)};
    
    function exportAsJson() {
      const dataStr = JSON.stringify(allData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'scamometer_all_reports_' + Date.now() + '.json';
      a.click();
      URL.revokeObjectURL(url);
    }
  </script>
</body>
</html>
  `;
}

async function exportAllAsJson() {
  if (allReports.length === 0) {
    alert('No reports to export');
    return;
  }
  
  const data = {
    exportDate: new Date().toISOString(),
    totalReports: allReports.length,
    reports: allReports
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scamometer_all_reports_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function clearAllReports() {
  if (!confirm('⚠️ Clear ALL reports? This will delete all analysis data. This action cannot be undone.')) return;
  
  const data = await chrome.storage.local.get(null);
  const keysToRemove = [];
  
  for (const key of Object.keys(data)) {
    if (key.startsWith('analysis::') || key === 'batch::queue' || key === 'batch::status') {
      keysToRemove.push(key);
    }
  }
  
  await chrome.storage.local.remove(keysToRemove);
  
  allReports = [];
  filteredReports = [];
  updateStats();
  renderReports();
  
  alert(`Cleared ${keysToRemove.length} reports`);
}
