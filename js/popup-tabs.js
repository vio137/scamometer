// Built by Arnab Mandal — contact: hello@arnabmandal.com
// Tabbed popup interface for Scamometer with batch processing

let currentAnalysisData = null;
let batchUrls = [];
let batchInterval = null;

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.dataset.tab;
    
    // Update active tab
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    // Update active content
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
    
    // Load content based on tab
    if (tabName === 'single') {
      refreshSingleTab();
    } else if (tabName === 'batch') {
      refreshBatchTab();
    } else if (tabName === 'dashboard') {
      refreshDashboard();
    }
  });
});

// ============================================================================
// SINGLE URL TAB (Original functionality)
// ============================================================================

async function refreshSingleTab() {
  const { apiKey, aiProvider = 'gemini', cerebrasApiKey } = await chrome.storage.local.get({ 
    apiKey: null,
    aiProvider: 'gemini',
    cerebrasApiKey: null
  });
  const needKey = document.getElementById('needKey');
  const content = document.getElementById('content');
  const kickoff = document.getElementById('kickoff');
  const kickbar = document.getElementById('kickbar');
  const kickpct = document.getElementById('kickpct');

  // Check if the appropriate API key exists based on provider
  const hasValidApiKey = (aiProvider === 'cerebras' && cerebrasApiKey) || 
                         (aiProvider === 'gemini' && apiKey);

  needKey.style.display = hasValidApiKey ? 'none' : 'block';
  if (!hasValidApiKey) {
    content.style.display = 'none';
    kickoff.style.display = 'none';
    return;
  }

  const tab = await getActiveTab();
  let data = await chrome.runtime.sendMessage({ type: 'GET_ANALYSIS_FOR_URL', url: tab.url });

  if (!data) {
    kickoff.style.display = 'block';
    content.style.display = 'none';
    let pct = 5;
    const timer = setInterval(() => {
      pct = Math.min(98, pct + 2);
      kickbar.style.width = pct + '%';
      kickpct.textContent = pct + '%';
    }, 180);
    
    await chrome.runtime.sendMessage({ type: 'RUN_ANALYSIS', tabId: tab.id, url: tab.url });
    clearInterval(timer);
    kickbar.style.width = '100%'; kickpct.textContent = '100%';
    data = await chrome.runtime.sendMessage({ type: 'GET_ANALYSIS_FOR_URL', url: tab.url });
    
    if (!data) {
      needKey.style.display = 'none';
      kickoff.innerHTML = '<div class="muted">Analysis queued. Please reopen after it completes.</div>';
      return;
    }
  }

  kickoff.style.display = 'none';
  content.style.display = 'flex';
  currentAnalysisData = data;

  document.getElementById('verdict').textContent = data.ai?.verdict || '—';
  document.getElementById('reason').textContent = data.ai?.reason || '—';
  if (typeof data.ai?.scamometer === "number") setGauge(data.ai.scamometer);
  else document.getElementById("scoreText").textContent = "Unavailable";

  const pos = Array.isArray(data.ai?.positives) ? data.ai.positives : [];
  const neg = Array.isArray(data.ai?.negatives) ? data.ai.negatives : [];
  document.getElementById('positives').innerHTML = chips(pos, 'pos');
  document.getElementById('negatives').innerHTML = chips(neg, 'neg');

  const raw = {
    fullUrl: data.raw?.fullUrl,
    pastedContent: data.raw?.pastedContent,
    technicalReport: data.raw?.technicalReport
  };
  document.getElementById('raw').textContent = JSON.stringify(raw, null, 2);

  const when = data.when ? new Date(data.when) : null;
  document.getElementById('timestamp').textContent = when
    ? `Analyzed: ${when.toLocaleString()}`
    : '—';

  setupSingleTabHandlers(tab);
}

function setupSingleTabHandlers(tab) {
  document.getElementById('reanalyze').onclick = async () => {
    await chrome.runtime.sendMessage({ type: 'RUN_ANALYSIS', tabId: tab.id, url: tab.url });
    window.close();
  };
  
  document.getElementById('openOptions').onclick = () => chrome.runtime.openOptionsPage();
  document.getElementById('openOptions2').onclick = () => chrome.runtime.openOptionsPage();
  
  document.getElementById('copyReportBtn').onclick = () => {
    if (!currentAnalysisData) return;
    const report = generateShareableReport(currentAnalysisData);
    navigator.clipboard.writeText(report).then(() => {
      const btn = document.getElementById('copyReportBtn');
      const original = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(() => btn.textContent = original, 2000);
    });
  };
  
  document.getElementById('exportPdfBtn').onclick = () => {
    if (!currentAnalysisData) return;
    const report = generateShareableReport(currentAnalysisData);
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const hostname = new URL(currentAnalysisData.url).hostname;
    a.download = `scamometer-report-${hostname}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  const rawToggle = document.getElementById('rawToggle');
  const rawContent = document.getElementById('rawContent');
  const chevron = rawToggle.querySelector('.chevron');
  
  rawToggle.onclick = () => {
    rawContent.classList.toggle('open');
    chevron.classList.toggle('open');
  };
}

// ============================================================================
// BATCH PROCESSING TAB
// ============================================================================

async function refreshBatchTab() {
  const status = await chrome.runtime.sendMessage({ type: 'GET_BATCH_STATUS' });
  
  if (status && status.status !== 'completed') {
    // Show progress
    document.getElementById('batchUpload').style.display = 'none';
    document.getElementById('batchProgress').style.display = 'block';
    updateBatchProgress(status);
    
    // Start polling for updates
    if (!batchInterval) {
      batchInterval = setInterval(async () => {
        const newStatus = await chrome.runtime.sendMessage({ type: 'GET_BATCH_STATUS' });
        if (newStatus) {
          updateBatchProgress(newStatus);
          if (newStatus.status === 'completed') {
            clearInterval(batchInterval);
            batchInterval = null;
            showToast('Batch processing completed!');
          }
        }
      }, 1000);
    }
  } else {
    // Show upload area
    document.getElementById('batchUpload').style.display = 'block';
    document.getElementById('batchProgress').style.display = 'none';
    setupBatchUpload();
  }
}

function setupBatchUpload() {
  const uploadArea = document.getElementById('uploadArea');
  const fileInput = document.getElementById('csvFile');
  const startBtn = document.getElementById('startBatchBtn');
  
  uploadArea.onclick = () => fileInput.click();
  
  uploadArea.ondragover = (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  };
  
  uploadArea.ondragleave = () => {
    uploadArea.classList.remove('dragover');
  };
  
  uploadArea.ondrop = (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
      handleCSVFile(file);
    }
  };
  
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleCSVFile(file);
    }
  };
  
  startBtn.onclick = async () => {
    if (batchUrls.length === 0) return;
    
    startBtn.disabled = true;
    await chrome.runtime.sendMessage({ type: 'START_BATCH', urls: batchUrls });
    
    // Switch to progress view
    document.getElementById('batchUpload').style.display = 'none';
    document.getElementById('batchProgress').style.display = 'block';
    
    // Start polling
    batchInterval = setInterval(async () => {
      const status = await chrome.runtime.sendMessage({ type: 'GET_BATCH_STATUS' });
      if (status) {
        updateBatchProgress(status);
        if (status.status === 'completed') {
          clearInterval(batchInterval);
          batchInterval = null;
          showToast('Batch processing completed!');
        }
      }
    }, 1000);
  };
  
  document.getElementById('pauseBatchBtn').onclick = async () => {
    await chrome.runtime.sendMessage({ type: 'PAUSE_BATCH' });
    document.getElementById('pauseBatchBtn').style.display = 'none';
    document.getElementById('resumeBatchBtn').style.display = 'block';
  };
  
  document.getElementById('resumeBatchBtn').onclick = async () => {
    await chrome.runtime.sendMessage({ type: 'RESUME_BATCH' });
    document.getElementById('pauseBatchBtn').style.display = 'block';
    document.getElementById('resumeBatchBtn').style.display = 'none';
  };
}

function handleCSVFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target.result;
    batchUrls = parseCSV(content);
    
    if (batchUrls.length === 0) {
      showToast('No valid URLs found in CSV', true);
      return;
    }
    
    document.getElementById('startBatchBtn').disabled = false;
    showToast(`Loaded ${batchUrls.length} URLs`);
  };
  reader.readAsText(file);
}

function parseCSV(content) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l);
  const urls = [];
  
  for (const line of lines) {
    // Skip comments
    if (line.startsWith('#')) continue;
    
    let firstCol = line.split(',')[0].trim();
    if (firstCol.startsWith('"') && firstCol.endsWith('"')) {
      firstCol = firstCol.slice(1, -1);
    }
    
    // Skip empty entries
    if (!firstCol) continue;
    
    // Normalize URL - add https:// if no protocol present
    let normalizedUrl = firstCol.trim();
    if (!normalizedUrl.match(/^https?:\/\//i)) {
      normalizedUrl = 'https://' + normalizedUrl;
    }
    
    // Validate URL
    try {
      const parsed = new URL(normalizedUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        urls.push(normalizedUrl);
      }
    } catch (e) {
      // Skip invalid URLs
      console.log('Skipping invalid URL:', firstCol);
    }
  }
  
  return urls;
}

function updateBatchProgress(status) {
  document.getElementById('batchBar').style.width = status.percentage + '%';
  document.getElementById('batchPercent').textContent = status.percentage + '%';
  document.getElementById('batchProgressText').textContent = 
    `Processing URL ${status.current + 1} of ${status.total}`;
  
  if (status.status === 'paused') {
    document.getElementById('batchStatus').textContent = 'Paused';
    document.getElementById('pauseBatchBtn').style.display = 'none';
    document.getElementById('resumeBatchBtn').style.display = 'block';
  } else {
    document.getElementById('batchStatus').textContent = 'Processing...';
    document.getElementById('pauseBatchBtn').style.display = 'block';
    document.getElementById('resumeBatchBtn').style.display = 'none';
  }
}

// ============================================================================
// REPORT DASHBOARD TAB
// ============================================================================

async function refreshDashboard() {
  const results = await chrome.runtime.sendMessage({ type: 'GET_BATCH_RESULTS' });
  
  if (!results || results.results.length === 0) {
    // No results yet
    document.getElementById('dashTotal').textContent = '0';
    document.getElementById('dashSuccess').textContent = '0';
    document.getElementById('dashFailed').textContent = '0';
    document.getElementById('dashAvgScore').textContent = '—';
    
    document.getElementById('resultsBody').innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 24px;">
          <div class="muted">No batch results yet. Start a batch analysis to see results here.</div>
        </td>
      </tr>
    `;
    return;
  }
  
  // Update statistics
  document.getElementById('dashTotal').textContent = results.total;
  document.getElementById('dashSuccess').textContent = results.completed;
  document.getElementById('dashFailed').textContent = results.failed;
  
  const completedResults = results.results.filter(r => r.status === 'completed' && r.result);
  const avgScore = completedResults.length > 0
    ? Math.round(completedResults.reduce((sum, r) => sum + (r.result.ai?.scamometer || 0), 0) / completedResults.length)
    : 0;
  document.getElementById('dashAvgScore').textContent = avgScore;
  
  // Update table
  renderResultsTable(results.results);
  
  // Setup export buttons
  setupDashboardExport(results);
}

function renderResultsTable(results) {
  const tbody = document.getElementById('resultsBody');
  
  if (results.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 24px;">
          <div class="muted">No results to display</div>
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = results.map((r, i) => {
    const hostname = r.url ? new URL(r.url).hostname : 'Unknown';
    const score = r.result?.ai?.scamometer || 0;
    const scoreClass = score >= 75 ? 'high' : (score >= 40 ? 'med' : 'low');
    
    let statusBadge = '';
    if (r.status === 'completed') {
      statusBadge = `<span class="pill ${scoreClass}">${Math.round(score)}</span>`;
    } else if (r.status === 'failed') {
      statusBadge = `<span class="pill high">Failed</span>`;
    } else {
      statusBadge = `<span class="muted">${r.status}</span>`;
    }
    
    return `
      <tr>
        <td class="url-cell" title="${escapeHtml(r.url)}">${escapeHtml(hostname)}</td>
        <td>${statusBadge}</td>
        <td>${r.status}</td>
        <td>
          <button onclick="viewResult(${i})" style="font-size: 11px; padding: 4px 8px;">View</button>
        </td>
      </tr>
    `;
  }).join('');
}

window.viewResult = async function(index) {
  const results = await chrome.runtime.sendMessage({ type: 'GET_BATCH_RESULTS' });
  const result = results.results[index];
  
  if (!result || !result.result) {
    showToast('No result data available', true);
    return;
  }
  
  // Show result in single tab
  currentAnalysisData = result.result;
  
  // Switch to single tab
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab')[0].classList.add('active');
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-single').classList.add('active');
  
  // Display the result
  const content = document.getElementById('content');
  content.style.display = 'flex';
  document.getElementById('needKey').style.display = 'none';
  document.getElementById('kickoff').style.display = 'none';
  
  document.getElementById('verdict').textContent = result.result.ai?.verdict || '—';
  document.getElementById('reason').textContent = result.result.ai?.reason || '—';
  setGauge(result.result.ai?.scamometer ?? 0);
  
  const pos = Array.isArray(result.result.ai?.positives) ? result.result.ai.positives : [];
  const neg = Array.isArray(result.result.ai?.negatives) ? result.result.ai.negatives : [];
  document.getElementById('positives').innerHTML = chips(pos, 'pos');
  document.getElementById('negatives').innerHTML = chips(neg, 'neg');
};

function setupDashboardExport(results) {
  document.getElementById('exportPdfDash').onclick = () => {
    exportAsPDF(results);
  };
  
  document.getElementById('exportJsonDash').onclick = () => {
    exportAsJSON(results);
  };
  
  // Search functionality
  document.getElementById('dashSearch').oninput = (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = results.results.filter(r => 
      r.url.toLowerCase().includes(query)
    );
    renderResultsTable(filtered);
  };
}

function exportAsPDF(results) {
  // Generate text-based report (PDF generation requires external library)
  let report = `SCAMOMETER BATCH ANALYSIS REPORT
${'='.repeat(60)}

Generated: ${new Date().toLocaleString()}
Total URLs: ${results.total}
Successful: ${results.completed}
Failed: ${results.failed}

${'='.repeat(60)}

RESULTS:
${'-'.repeat(60)}

`;

  results.results.forEach((r, i) => {
    report += `${i + 1}. ${r.url}\n`;
    report += `   Status: ${r.status}\n`;
    if (r.result?.ai) {
      report += `   Score: ${Math.round(r.result.ai.scamometer)}/100\n`;
      report += `   Verdict: ${r.result.ai.verdict}\n`;
      report += `   Reason: ${r.result.ai.reason}\n`;
    }
    if (r.error) {
      report += `   Error: ${r.error}\n`;
    }
    report += '\n';
  });

  report += `${'='.repeat(60)}\n`;
  report += `Report generated by Scamometer\n`;
  report += `https://github.com/vio137/scamometer\n`;

  const blob = new Blob([report], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scamometer-batch-report-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('Report exported as text file');
}

function exportAsJSON(results) {
  const json = JSON.stringify(results, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scamometer-batch-results-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  
  showToast('Results exported as JSON');
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setGauge(score) {
  const pct = Math.max(0, Math.min(100, Math.round(score || 0)));
  const angle = 180 * (pct / 100);
  const needle = document.getElementById('hand');
  needle.style.transition = 'transform 0.5s ease-in-out';
  needle.setAttribute('transform', `rotate(${angle - 90} 50 50)`);
  document.getElementById('scoreText').textContent = `${pct} / 100`;
  const pill = document.getElementById('riskpill');
  const label = pct >= 75 ? 'High risk' : (pct >= 40 ? 'Medium risk' : 'Low risk');
  pill.className = `pill ${asClass(pct)}`;
  pill.textContent = label;
}

function asClass(pct) {
  if (pct >= 75) return 'high';
  if (pct >= 40) return 'med';
  return 'low';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
  );
}

function chips(list, cls) {
  return (list || []).map(v => `<span class="tag ${cls}">${escapeHtml(v)}</span>`).join('');
}

function generateShareableReport(data) {
  let url = data.url;
  try {
    new URL(url);
  } catch (e) {
    url = 'Invalid URL';
  }
  
  const score = data.ai?.scamometer;
  const verdict = data.ai?.verdict || 'Unknown';
  const reason = data.ai?.reason || 'No reason provided';
  const positives = data.ai?.positives || [];
  const negatives = data.ai?.negatives || [];
  const timestamp = data.when ? new Date(data.when).toLocaleString() : 'Unknown';
  
  return `🧪 SCAMOMETER SECURITY REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
URL: ${url}
Risk Score: ${typeof score === "number" ? `${Math.round(score)}/100` : "Unavailable"}
Verdict: ${verdict}
Analyzed: ${timestamp}

REASON:
${reason}

POSITIVE INDICATORS (${positives.length}):
${positives.map(p => `✓ ${p}`).join('\n') || 'None'}

RED FLAGS (${negatives.length}):
${negatives.map(n => `✗ ${n}`).join('\n') || 'None'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated by Scamometer - AI Phishing Detector
https://github.com/vio137/scamometer
`;
}

function showToast(message, isError = false) {
  const existing = document.getElementById('toast-notification');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.id = 'toast-notification';
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '16px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%) translateY(60px)';
  toast.style.padding = '10px 16px';
  toast.style.background = isError ? '#dc2626' : '#16a34a';
  toast.style.color = 'white';
  toast.style.borderRadius = '8px';
  toast.style.fontSize = '13px';
  toast.style.fontWeight = '600';
  toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  toast.style.zIndex = '10000';
  toast.style.transition = 'transform 0.3s ease';
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(0)';
  }, 10);
  
  setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(60px)';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// ============================================================================
// API KEY ERROR HANDLING
// ============================================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'API_KEY_ERROR') {
    showApiKeyModal();
  }
  if (msg?.type === 'BATCH_COMPLETE') {
    showToast('Batch processing completed!');
    refreshDashboard();
  }
});

function showApiKeyModal() {
  const modal = document.getElementById('apiKeyModal');
  modal.classList.add('active');
  
  document.getElementById('cancelApiKey').onclick = () => {
    modal.classList.remove('active');
  };
  
  document.getElementById('saveApiKey').onclick = async () => {
    const newKey = document.getElementById('newApiKey').value.trim();
    if (!newKey) {
      showToast('Please enter an API key', true);
      return;
    }
    
    await chrome.storage.local.set({ apiKey: newKey });
    modal.classList.remove('active');
    
    // Resume batch processing
    await chrome.runtime.sendMessage({ type: 'RESUME_BATCH' });
    showToast('API key updated, resuming...');
  };
}

// ============================================================================
// INITIALIZATION
// ============================================================================

// Load initial tab
refreshSingleTab();
