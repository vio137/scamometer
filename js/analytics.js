// Built by Arnab Mandal — contact: hello@arnabmandal.com

let analyticsData = {
  totalScans: 0,
  lowRisk: 0,
  mediumRisk: 0,
  highRisk: 0,
  avgScore: 0,
  domainCounts: {},
  reports: []
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await loadAnalytics();
  renderAnalytics();
  setupEventListeners();
});

function setupEventListeners() {
  document.getElementById('exportAnalytics').addEventListener('click', exportAnalyticsReport);
  document.getElementById('exportJson').addEventListener('click', exportAsJson);
  
  // Navigation buttons
  document.getElementById('navReports')?.addEventListener('click', () => location.href = 'reports.html');
  document.getElementById('navBatch')?.addEventListener('click', () => location.href = 'batch.html');
  document.getElementById('navTasks')?.addEventListener('click', () => location.href = 'tasks.html');
  document.getElementById('navSettings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
}

async function loadAnalytics() {
  const data = await chrome.storage.local.get(null);
  const reports = [];
  
  // Load batch results
  if (data['batch::queue']) {
    const queue = data['batch::queue'];
    if (queue.urls && Array.isArray(queue.urls)) {
      queue.urls.forEach(item => {
        if (item.status === 'completed' && item.result) {
          reports.push({
            url: item.url,
            result: item.result,
            timestamp: queue.timestamp || Date.now()
          });
        }
      });
    }
  }
  
  // Load single URL analyses
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('analysis::') && value) {
      reports.push({
        url: key.replace('analysis::', ''),
        result: value,
        timestamp: value.timestamp || Date.now()
      });
    }
  }
  
  // Calculate analytics
  analyticsData.totalScans = reports.length;
  analyticsData.lowRisk = 0;
  analyticsData.mediumRisk = 0;
  analyticsData.highRisk = 0;
  analyticsData.domainCounts = {};
  analyticsData.reports = reports;
  
  let totalScore = 0;
  
  reports.forEach(report => {
    const score = report.result?.ai?.scamometer || 0;
    totalScore += score;
    
    if (score < 30) analyticsData.lowRisk++;
    else if (score < 70) analyticsData.mediumRisk++;
    else analyticsData.highRisk++;
    
    // Count domains
    try {
      const hostname = new URL(report.url).hostname;
      analyticsData.domainCounts[hostname] = (analyticsData.domainCounts[hostname] || 0) + 1;
    } catch (e) {
      // Invalid URL
    }
  });
  
  analyticsData.avgScore = reports.length > 0 ? Math.round(totalScore / reports.length) : 0;
}

function renderAnalytics() {
  // Update stats
  document.getElementById('totalScans').textContent = analyticsData.totalScans;
  document.getElementById('safeCount').textContent = analyticsData.lowRisk;
  document.getElementById('suspiciousCount').textContent = analyticsData.mediumRisk;
  document.getElementById('dangerousCount').textContent = analyticsData.highRisk;
  document.getElementById('avgScore').textContent = analyticsData.avgScore;
  
  // Update chart
  const maxCount = Math.max(analyticsData.lowRisk, analyticsData.mediumRisk, analyticsData.highRisk);
  const lowPercent = maxCount > 0 ? (analyticsData.lowRisk / maxCount) * 100 : 0;
  const mediumPercent = maxCount > 0 ? (analyticsData.mediumRisk / maxCount) * 100 : 0;
  const highPercent = maxCount > 0 ? (analyticsData.highRisk / maxCount) * 100 : 0;
  
  const barLow = document.getElementById('barLow');
  const barMedium = document.getElementById('barMedium');
  const barHigh = document.getElementById('barHigh');
  
  barLow.style.height = Math.max(lowPercent, 5) + '%';
  barLow.querySelector('.bar-value').textContent = analyticsData.lowRisk;
  
  barMedium.style.height = Math.max(mediumPercent, 5) + '%';
  barMedium.querySelector('.bar-value').textContent = analyticsData.mediumRisk;
  
  barHigh.style.height = Math.max(highPercent, 5) + '%';
  barHigh.querySelector('.bar-value').textContent = analyticsData.highRisk;
  
  // Render top domains
  renderTopDomains();
}

function renderTopDomains() {
  const container = document.getElementById('topDomains');
  const empty = document.getElementById('emptyDomains');
  
  const sortedDomains = Object.entries(analyticsData.domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  if (sortedDomains.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  
  empty.style.display = 'none';
  
  container.innerHTML = sortedDomains.map(([domain, count]) => `
    <li class="domain-item">
      <div class="domain-name">${escapeHtml(domain)}</div>
      <div class="domain-count">${count} scan${count > 1 ? 's' : ''}</div>
    </li>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function exportAnalyticsReport() {
  const html = generateAnalyticsReport();
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scamometer_analytics_${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

function generateAnalyticsReport() {
  const date = new Date().toLocaleString();
  const sortedDomains = Object.entries(analyticsData.domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Scamometer Analytics Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: ui-sans-serif, system-ui, sans-serif;
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
      text-align: center;
      border-bottom: 2px solid #1f2937;
      padding-bottom: 24px;
      margin-bottom: 32px;
    }
    h1 { font-size: 36px; margin-bottom: 12px; }
    .meta { color: #94a3b8; font-size: 14px; }
    h2 {
      font-size: 24px;
      color: #06b6d4;
      margin: 32px 0 16px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin: 24px 0;
    }
    .stat-card {
      background: #0b1020;
      border: 1px solid #1f2937;
      border-radius: 12px;
      padding: 24px;
      text-align: center;
    }
    .stat-value {
      font-size: 42px;
      font-weight: 700;
      margin-bottom: 8px;
      color: #06b6d4;
    }
    .stat-label {
      font-size: 12px;
      color: #94a3b8;
      text-transform: uppercase;
    }
    .domain-list {
      list-style: none;
      padding: 0;
    }
    .domain-item {
      display: flex;
      justify-content: space-between;
      padding: 12px 16px;
      background: #0b1020;
      border-radius: 8px;
      margin-bottom: 8px;
      border: 1px solid #1f2937;
    }
    .domain-name { font-weight: 600; }
    .domain-count {
      background: rgba(6, 182, 212, 0.2);
      color: #06b6d4;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
    }
    .chart {
      display: flex;
      gap: 16px;
      margin: 24px 0;
      height: 200px;
      align-items: flex-end;
    }
    .chart-bar {
      flex: 1;
      border-radius: 8px 8px 0 0;
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      align-items: center;
      padding: 12px;
    }
    .chart-bar.low { background: linear-gradient(180deg, #16a34a, #15803d); }
    .chart-bar.medium { background: linear-gradient(180deg, #eab308, #d97706); }
    .chart-bar.high { background: linear-gradient(180deg, #dc2626, #b91c1c); }
    .chart-value { font-size: 24px; font-weight: 700; color: white; }
    .chart-label { font-size: 12px; color: #94a3b8; margin-top: 12px; text-align: center; }
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
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📈 Scamometer Analytics Report</h1>
      <div class="meta">Generated: ${date}</div>
    </header>
    
    <h2>Overview</h2>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${analyticsData.totalScans}</div>
        <div class="stat-label">Total Scans</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #16a34a;">${analyticsData.lowRisk}</div>
        <div class="stat-label">Safe Sites</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #eab308;">${analyticsData.mediumRisk}</div>
        <div class="stat-label">Suspicious</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" style="color: #dc2626;">${analyticsData.highRisk}</div>
        <div class="stat-label">Dangerous</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${analyticsData.avgScore}</div>
        <div class="stat-label">Avg Risk Score</div>
      </div>
    </div>
    
    <h2>Risk Distribution</h2>
    <div class="chart">
      <div class="chart-bar low" style="height: ${Math.max((analyticsData.lowRisk / Math.max(analyticsData.lowRisk, analyticsData.mediumRisk, analyticsData.highRisk, 1)) * 100, 20)}%;">
        <div class="chart-value">${analyticsData.lowRisk}</div>
      </div>
      <div class="chart-bar medium" style="height: ${Math.max((analyticsData.mediumRisk / Math.max(analyticsData.lowRisk, analyticsData.mediumRisk, analyticsData.highRisk, 1)) * 100, 20)}%;">
        <div class="chart-value">${analyticsData.mediumRisk}</div>
      </div>
      <div class="chart-bar high" style="height: ${Math.max((analyticsData.highRisk / Math.max(analyticsData.lowRisk, analyticsData.mediumRisk, analyticsData.highRisk, 1)) * 100, 20)}%;">
        <div class="chart-value">${analyticsData.highRisk}</div>
      </div>
    </div>
    <div style="display: flex; gap: 16px; justify-content: center; margin-top: 16px;">
      <div class="chart-label">Low Risk<br>(0-29)</div>
      <div class="chart-label">Medium Risk<br>(30-69)</div>
      <div class="chart-label">High Risk<br>(70-100)</div>
    </div>
    
    <h2>Top 20 Most Analyzed Domains</h2>
    <ul class="domain-list">
      ${sortedDomains.map(([domain, count]) => `
        <li class="domain-item">
          <div class="domain-name">${escapeHtml(domain)}</div>
          <div class="domain-count">${count} scan${count > 1 ? 's' : ''}</div>
        </li>
      `).join('')}
    </ul>
    
    <footer>
      Generated by <strong>Scamometer</strong> v3.0<br>
      Built by Arnab Mandal — <a href="https://github.com/vio137/scamometer" style="color: #06b6d4;">GitHub</a>
    </footer>
  </div>
</body>
</html>
  `;
}

async function exportAsJson() {
  const data = {
    exportDate: new Date().toISOString(),
    analytics: {
      totalScans: analyticsData.totalScans,
      lowRisk: analyticsData.lowRisk,
      mediumRisk: analyticsData.mediumRisk,
      highRisk: analyticsData.highRisk,
      avgScore: analyticsData.avgScore,
      domainCounts: analyticsData.domainCounts
    },
    reports: analyticsData.reports
  };
  
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scamometer_analytics_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
