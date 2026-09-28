// Built by Arnab Mandal — contact: hello@arnabmandal.com

let currentAnalysisData = null;
let extensionEnabled = false;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Load extension state
  const { enabled = false } = await chrome.storage.local.get({ enabled: false });
  extensionEnabled = enabled;
  updateToggleUI();
  
  if (extensionEnabled) {
    await refresh();
  } else {
    showDisabledState();
  }
  
  setupEventListeners();
});

function setupEventListeners() {
  // Toggle switch
  document.getElementById('toggleSwitch').onclick = toggleExtension;
  
  // Buttons
  document.getElementById('openOptions')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
  document.getElementById('reanalyze')?.addEventListener('click', reanalyze);
  document.getElementById('copyReport')?.addEventListener('click', copyReport);
  
  // Payload buttons
  document.getElementById('togglePayload')?.addEventListener('click', togglePayloadView);
  document.getElementById('copyPayload')?.addEventListener('click', copyPayload);
  
  // Navigation buttons
  document.getElementById('reportsBtn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('html/reports.html') });
  });
  document.getElementById('batchBtn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('html/batch.html') });
  });
  document.getElementById('tasksBtn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('html/tasks.html') });
  });
  document.getElementById('analyticsBtn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('html/analytics.html') });
  });
  document.getElementById('optionsBtn')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
}

async function toggleExtension() {
  extensionEnabled = !extensionEnabled;
  await chrome.storage.local.set({ enabled: extensionEnabled });
  updateToggleUI();
  
  if (extensionEnabled) {
    showToast('Extension enabled');
    await refresh();
  } else {
    showToast('Extension disabled');
    showDisabledState();
  }
}

function updateToggleUI() {
  const toggle = document.getElementById('toggleSwitch');
  const status = document.getElementById('toggleStatus');
  
  if (extensionEnabled) {
    toggle.classList.add('active');
    status.textContent = 'ON';
    status.classList.add('active');
  } else {
    toggle.classList.remove('active');
    status.textContent = 'OFF';
    status.classList.remove('active');
  }
}

function showDisabledState() {
  document.getElementById('needKey').style.display = 'none';
  document.getElementById('loading').style.display = 'none';
  document.getElementById('results').style.display = 'none';
  document.getElementById('navMenu').style.display = 'block';
  document.getElementById('disabledState').style.display = 'block';
}

async function refresh() {
  // Check for Model B configuration (required)
  const config = await chrome.storage.local.get({ 
    modelB_provider: 'gemini',
    modelB_apiKey: null,
    modelB_cerebrasApiKey: null,
    modelB_customApiKey: null,
    modelB_customEndpoint: null,
    modelB_customModel: null,
    // Legacy fallback
    apiKey: null,
    aiProvider: 'gemini',
    cerebrasApiKey: null
  });
  
  // Always show nav menu
  document.getElementById('navMenu').style.display = 'block';
  
  // Check if Model B is configured (with legacy fallback)
  const provider = config.modelB_provider || config.aiProvider || 'gemini';
  let hasValidApiKey = false;
  
  if (provider === 'gemini') {
    hasValidApiKey = !!(config.modelB_apiKey || config.apiKey);
  } else if (provider === 'cerebras') {
    hasValidApiKey = !!(config.modelB_cerebrasApiKey || config.cerebrasApiKey);
  } else if (provider === 'custom') {
    hasValidApiKey = !!(config.modelB_customApiKey || config.customApiKey) && 
                     !!(config.modelB_customEndpoint || config.customEndpoint) &&
                     !!(config.modelB_customModel || config.customModel);
  }
  
  if (!hasValidApiKey) {
    document.getElementById('needKey').style.display = 'block';
    document.getElementById('loading').style.display = 'none';
    document.getElementById('results').style.display = 'none';
    document.getElementById('disabledState').style.display = 'none';
    return;
  }
  
  // Get active tab
  const tab = await getActiveTab();
  if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
    showToast('Cannot analyze Chrome internal pages', true);
    document.getElementById('needKey').style.display = 'none';
    document.getElementById('loading').style.display = 'none';
    document.getElementById('results').style.display = 'none';
    document.getElementById('disabledState').style.display = 'none';
    return;
  }
  
  // Get analysis
  let data = await chrome.runtime.sendMessage({ type: 'GET_ANALYSIS_FOR_URL', url: tab.url });
  
  if (!data) {
    // Show loading
    document.getElementById('needKey').style.display = 'none';
    document.getElementById('loading').style.display = 'block';
    document.getElementById('results').style.display = 'none';
    document.getElementById('disabledState').style.display = 'none';
    
    // Run analysis
    await chrome.runtime.sendMessage({ type: 'RUN_ANALYSIS', tabId: tab.id, url: tab.url });
    
    // Wait and get result
    await new Promise(resolve => setTimeout(resolve, 2000));
    data = await chrome.runtime.sendMessage({ type: 'GET_ANALYSIS_FOR_URL', url: tab.url });
  }
  
  if (!data) {
    showToast('Analysis in progress, please wait...', true);
    return;
  }
  
  // Show results
  displayResults(data);
}

function displayResults(data) {
  document.getElementById('needKey').style.display = 'none';
  document.getElementById('loading').style.display = 'none';
  document.getElementById('results').style.display = 'flex';
  document.getElementById('navMenu').style.display = 'block';
  document.getElementById('disabledState').style.display = 'none';
  
  currentAnalysisData = data;
  
  // Update badge
  if (typeof data.ai?.scamometer === "number") {
    chrome.runtime.sendMessage({ 
      type: 'SET_BADGE', 
      score: data.ai.scamometer 
    }).catch(() => {});
  }
  
  const score = data.ai?.scamometer;
  const verdict = data.ai?.verdict || '—';
  const reason = data.ai?.reason || '—';
  const positives = Array.isArray(data.ai?.positives) ? data.ai.positives : [];
  const negatives = Array.isArray(data.ai?.negatives) ? data.ai.negatives : [];
  
  // Update gauge
  if (typeof score === "number") setGauge(score);
  else document.getElementById("scoreText").textContent = "Unavailable";
  
  // Update verdict
  document.getElementById('verdict').textContent = verdict;
  document.getElementById('reason').textContent = reason;
  
  // Update pills
  const pill = document.getElementById('riskpill');
  const label = score >= 75 ? 'High risk' : (score >= 40 ? 'Medium risk' : 'Low risk');
  const pillClass = score >= 75 ? 'high' : (score >= 40 ? 'med' : 'low');
  pill.className = `pill ${pillClass}`;
  pill.textContent = label;
  
  // Update tags
  const posContainer = document.getElementById('positives');
  const negContainer = document.getElementById('negatives');
  
  if (positives.length > 0) {
    posContainer.innerHTML = positives.map(p => `<span class="tag pos">✓ ${escapeHtml(p)}</span>`).join('');
  } else {
    posContainer.innerHTML = '<span class="muted">None found</span>';
  }
  
  if (negatives.length > 0) {
    negContainer.innerHTML = negatives.map(n => `<span class="tag neg">✗ ${escapeHtml(n)}</span>`).join('');
  } else {
    negContainer.innerHTML = '<span class="muted">None found</span>';
  }
  
  // Display summarizer output (if available)
  if (data.summary && data.summary.summary) {
    document.getElementById('summaryCard').style.display = 'block';
    document.getElementById('summaryText').textContent = data.summary.summary;
    
    const labelsContainer = document.getElementById('summaryLabels');
    if (data.summary.labels && data.summary.labels.length > 0) {
      labelsContainer.innerHTML = data.summary.labels.map(l => 
        `<span class="tag" style="border-color:rgba(6,182,212,.5); background:rgba(6,182,212,.1); color:var(--cyan);">${escapeHtml(l)}</span>`
      ).join('');
    } else {
      labelsContainer.innerHTML = '';
    }
  } else {
    document.getElementById('summaryCard').style.display = 'none';
  }
  
  // Display compact payload (if available)
  if (data.compactPayload) {
    document.getElementById('payloadCard').style.display = 'block';
    const payloadEl = document.getElementById('payloadContent');
    payloadEl.textContent = JSON.stringify(data.compactPayload);
    payloadEl.dataset.minified = JSON.stringify(data.compactPayload);
    payloadEl.dataset.pretty = JSON.stringify(data.compactPayload, null, 2);
    payloadEl.dataset.isPretty = 'false';
  } else {
    document.getElementById('payloadCard').style.display = 'none';
  }
  
  // Display model information (if available)
  if (data.timing || data.summary) {
    document.getElementById('modelInfoCard').style.display = 'block';
    
    // Model A info
    const modelASource = data.summary?.source || 'unknown';
    let modelAInfo = 'Not configured';
    if (modelASource === 'summarizer') {
      modelAInfo = '✓ AI Summarizer';
    } else if (modelASource === 'text_only') {
      modelAInfo = 'Text only (no AI)';
    }
    document.getElementById('modelAInfo').textContent = modelAInfo;
    
    // Model B info
    document.getElementById('modelBInfo').textContent = '✓ AI Judge (verdict model)';
    
    // Timing info
    if (data.timing) {
      const summarizerMs = data.timing.summarizerMs || 0;
      const recordMs = data.timing.recordMs || 0;
      const totalMs = data.timing.totalMs || 0;
      document.getElementById('timingInfo').textContent = 
        `Summarizer: ${summarizerMs}ms, DNS/RDAP: ${recordMs}ms, Total: ${totalMs}ms`;
    } else {
      document.getElementById('timingInfo').textContent = 'Not available';
    }
  } else {
    document.getElementById('modelInfoCard').style.display = 'none';
  }
}

function setGauge(score) {
  const pct = Math.max(0, Math.min(100, Math.round(score || 0)));
  const angle = 180 * (pct / 100);
  const needle = document.getElementById('needle');
  needle.style.transition = 'transform 0.5s ease-in-out';
  needle.setAttribute('transform', `rotate(${angle - 90} 50 50)`);
  document.getElementById('scoreText').textContent = `${pct}/100`;
}

async function reanalyze() {
  const tab = await getActiveTab();
  if (!tab) return;
  
  showToast('Re-analyzing...');
  await chrome.runtime.sendMessage({ type: 'RUN_ANALYSIS', tabId: tab.id, url: tab.url });
  
  setTimeout(() => refresh(), 2000);
}

function copyReport() {
  if (!currentAnalysisData) return;
  
  const report = generateReport(currentAnalysisData);
  navigator.clipboard.writeText(report).then(() => {
    showToast('✓ Report copied to clipboard');
  }).catch(() => {
    showToast('✗ Failed to copy', true);
  });
}

function openBatchPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL('html/batch.html') });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function generateReport(data) {
  const url = data.url || 'Unknown';
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
  );
}

function showToast(message, isError = false) {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 16px;
    background: ${isError ? '#dc2626' : '#16a34a'};
    color: white;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 10000;
  `;
  
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

// Toggle payload view between minified and pretty
function togglePayloadView() {
  const payloadEl = document.getElementById('payloadContent');
  const isPretty = payloadEl.dataset.isPretty === 'true';
  
  if (isPretty) {
    payloadEl.textContent = payloadEl.dataset.minified;
    payloadEl.dataset.isPretty = 'false';
  } else {
    payloadEl.textContent = payloadEl.dataset.pretty;
    payloadEl.dataset.isPretty = 'true';
  }
}

// Copy payload to clipboard
function copyPayload() {
  const payloadEl = document.getElementById('payloadContent');
  navigator.clipboard.writeText(payloadEl.textContent).then(() => {
    showToast('✓ Payload copied to clipboard');
  }).catch(() => {
    showToast('✗ Failed to copy', true);
  });
}

// Listen for messages
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'analysis_complete') {
    refresh();
  }
});
