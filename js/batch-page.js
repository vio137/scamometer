// Batch Processing Page JavaScript
// Built by Arnab Mandal - hello@arnabmandal.com

let batchUrls = [];
let batchResults = [];
let pollInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  checkExistingBatch();
});

function setupEventListeners() {
  const uploadZone = document.getElementById('uploadZone');
  const fileInput = document.getElementById('csvFile');
  
  // File upload
  uploadZone.onclick = () => fileInput.click();
  
  uploadZone.ondragover = (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  };
  
  uploadZone.ondragleave = () => {
    uploadZone.classList.remove('dragover');
  };
  
  uploadZone.ondrop = (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.csv')) {
      handleFile(file);
    }
  };
  
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  };
  
  // Buttons
  document.getElementById('startBtn').onclick = startBatch;
  document.getElementById('retryBtn').onclick = retryFailedUrls;
  document.getElementById('clearBtn').onclick = clearUpload;
  document.getElementById('pauseBtn').onclick = pauseBatch;
  document.getElementById('resumeBtn').onclick = resumeBatch;
  document.getElementById('stopBtn').onclick = stopBatch;
  document.getElementById('exportHtmlBtn').onclick = exportHtmlReport;
  document.getElementById('exportJsonBtn').onclick = exportJsonReport;
  document.getElementById('newBatchBtn').onclick = newBatch;
  
  // Close button
  document.getElementById('closeBtn')?.addEventListener('click', () => {
    window.close();
  });
  
  // API Key Modal
  document.getElementById('cancelApiKeyBtn').onclick = () => {
    document.getElementById('apiKeyModal').classList.remove('active');
  };
  document.getElementById('saveApiKeyBtn').onclick = saveNewApiKey;
  
  // Listen for messages from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'API_KEY_ERROR') {
      showApiKeyModal();
    } else if (msg.type === 'BATCH_COMPLETE') {
      handleBatchComplete();
    }
  });
}

function handleFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target.result;
    batchUrls = parseCSV(content);
    
    if (batchUrls.length === 0) {
      showToast('No valid URLs found in CSV', true);
      return;
    }
    
    document.getElementById('fileInfo').style.display = 'block';
    document.getElementById('fileInfo').textContent = `✅ Loaded ${batchUrls.length} URLs from ${file.name}`;
    document.getElementById('startBtn').disabled = false;
    showToast(`Loaded ${batchUrls.length} URLs successfully`);
  };
  reader.readAsText(file);
}

function parseCSV(content) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const urls = [];
  
  for (const line of lines) {
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

function clearUpload() {
  batchUrls = [];
  document.getElementById('csvFile').value = '';
  document.getElementById('fileInfo').style.display = 'none';
  document.getElementById('startBtn').disabled = true;
  showToast('Cleared');
}

async function startBatch() {
  if (batchUrls.length === 0) return;
  
  // Start batch processing
  await chrome.runtime.sendMessage({
    type: 'START_BATCH',
    urls: batchUrls
  });
  
  // Show progress section
  document.getElementById('uploadSection').style.display = 'none';
  document.getElementById('progressSection').classList.add('active');
  document.getElementById('resultsSection').style.display = 'none';
  
  // Start polling for updates
  startPolling();
  showToast('Batch processing started');
}

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  
  pollInterval = setInterval(async () => {
    const status = await chrome.runtime.sendMessage({ type: 'GET_BATCH_STATUS' });
    if (status) {
      updateProgress(status);
      
      if (status.status === 'completed') {
        clearInterval(pollInterval);
        pollInterval = null;
        await handleBatchComplete();
      }
    }
  }, 1000);
}

function updateProgress(status) {
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const progressStats = document.getElementById('progressStats');
  
  progressBar.style.width = status.percentage + '%';
  progressText.innerHTML = `<span class="spinner">⚡</span> Processing URL ${status.current + 1} of ${status.total}`;
  progressStats.textContent = `${status.current} / ${status.total} (${status.percentage}%)`;
  
  if (status.status === 'paused') {
    progressText.innerHTML = '⏸️ Paused';
    document.getElementById('pauseBtn').style.display = 'none';
    document.getElementById('resumeBtn').style.display = 'inline-block';
  }
}

async function pauseBatch() {
  await chrome.runtime.sendMessage({ type: 'PAUSE_BATCH' });
  document.getElementById('pauseBtn').style.display = 'none';
  document.getElementById('resumeBtn').style.display = 'inline-block';
  showToast('Batch paused');
}

async function resumeBatch() {
  await chrome.runtime.sendMessage({ type: 'RESUME_BATCH' });
  document.getElementById('pauseBtn').style.display = 'inline-block';
  document.getElementById('resumeBtn').style.display = 'none';
  startPolling();
  showToast('Batch resumed');
}

async function stopBatch() {
  if (confirm('Are you sure you want to stop the batch processing?')) {
    await chrome.runtime.sendMessage({ type: 'PAUSE_BATCH' });
    clearInterval(pollInterval);
    pollInterval = null;
    await handleBatchComplete();
    showToast('Batch stopped');
  }
}

async function handleBatchComplete() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  
  // Get results
  const results = await chrome.runtime.sendMessage({ type: 'GET_BATCH_RESULTS' });
  if (!results) return;
  
  batchResults = results.results || [];
  
  // Hide progress, show results
  document.getElementById('progressSection').classList.remove('active');
  document.getElementById('resultsSection').style.display = 'block';
  
  // Update stats
  const completed = batchResults.filter(r => r.status === 'completed' && r.result);
  const avgScore = completed.length > 0
    ? Math.round(completed.reduce((sum, r) => sum + (r.result.ai?.scamometer || 0), 0) / completed.length)
    : 0;
  
  document.getElementById('totalCount').textContent = results.total || 0;
  document.getElementById('successCount').textContent = results.completed || 0;
  document.getElementById('failedCount').textContent = results.failed || 0;
  document.getElementById('avgScore').textContent = avgScore;
  
  // Render table
  renderResultsTable();
  showToast('✅ Batch processing completed!');
}

function renderResultsTable() {
  const tbody = document.getElementById('resultsBody');
  
  if (batchResults.length === 0) {
    tbody.innerHTML = '';
    document.getElementById('emptyResults').style.display = 'block';
    return;
  }
  
  document.getElementById('emptyResults').style.display = 'none';
  
  tbody.innerHTML = batchResults.map((result, index) => {
    const score = result.result?.ai?.scamometer || 0;
    const scoreClass = score >= 75 ? 'high' : (score >= 40 ? 'medium' : 'low');
    const hostname = result.url ? new URL(result.url).hostname : 'Unknown';
    
    let statusBadge = '';
    if (result.status === 'completed') {
      statusBadge = `<span class="status-badge completed">✓ Completed</span>`;
    } else if (result.status === 'failed') {
      statusBadge = `<span class="status-badge failed">✗ Failed</span>`;
    } else {
      statusBadge = `<span class="status-badge processing">⏳ ${result.status}</span>`;
    }
    
    return `
      <tr>
        <td>${index + 1}</td>
        <td title="${escapeHtml(result.url)}">${escapeHtml(hostname)}</td>
        <td><span class="score-badge ${scoreClass}">${Math.round(score)}/100</span></td>
        <td>${statusBadge}</td>
      </tr>
    `;
  }).join('');
  
  // Show or hide retry button based on failed URLs
  updateRetryButton();
}

function updateRetryButton() {
  const failedUrls = batchResults.filter(r => r.status === 'failed');
  const retryBtn = document.getElementById('retryBtn');
  
  if (failedUrls.length > 0) {
    retryBtn.style.display = 'inline-block';
    retryBtn.textContent = `🔄 Retry ${failedUrls.length} Failed URL${failedUrls.length > 1 ? 's' : ''}`;
  } else {
    retryBtn.style.display = 'none';
  }
}

async function retryFailedUrls() {
  // Get all failed URLs
  const failedResults = batchResults.filter(r => r.status === 'failed');
  
  if (failedResults.length === 0) {
    showToast('No failed URLs to retry', true);
    return;
  }
  
  const failedUrls = failedResults.map(r => r.url);
  showToast(`🔄 Retrying ${failedUrls.length} failed URL(s)...`);
  
  // Reset status for failed URLs in batchResults
  failedResults.forEach(result => {
    result.status = 'pending';
    result.error = null;
  });
  
  // Hide retry button during processing
  document.getElementById('retryBtn').style.display = 'none';
  
  // Create a new batch with only failed URLs
  const retryBatch = {
    urls: failedUrls.map((url, idx) => ({
      url: url,
      index: batchResults.findIndex(r => r.url === url && r.status === 'pending')
    })),
    currentIndex: 0,
    status: 'processing'
  };
  
  // Save to storage
  await chrome.storage.local.set({ 'batch::queue': retryBatch });
  
  // Start processing the retry batch
  await chrome.runtime.sendMessage({ type: 'START_BATCH', urls: failedUrls });
  
  // Show progress section
  document.getElementById('progressSection').classList.add('active');
  document.getElementById('resultsSection').style.display = 'none';
  
  // Start polling for updates
  pollBatchStatus();
  
  showToast(`Started retry for ${failedUrls.length} URL(s)`);
}


window.viewResult = function(index) {
  const result = batchResults[index];
  if (!result || !result.result) {
    showToast('No result data available', true);
    return;
  }
  
  // Open in new tab with full details
  const detailHtml = generateDetailReport(result);
  const blob = new Blob([detailHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
};

window.downloadIndividualReport = function(index) {
  const result = batchResults[index];
  if (!result) return;
  
  const html = generateDetailReport(result);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const hostname = result.url ? new URL(result.url).hostname : 'unknown';
  a.download = `scamometer-report-${hostname}-${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Individual report downloaded');
};

async function exportHtmlReport() {
  // Get the batch folder name from queue
  const data = await chrome.storage.local.get('batch::queue');
  const queue = data['batch::queue'];
  const batchFolderName = queue?.batchFolderName || `scamometer-reports-${Date.now()}`;
  
  const html = generateInteractiveReport();
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  
  // Use chrome.downloads API to save to batch folder
  chrome.downloads.download({
    url: url,
    filename: `${batchFolderName}/scamometer_report.html`,
    saveAs: false
  }).then(() => {
    showToast(`✅ Interactive HTML report downloaded to ${batchFolderName} folder!`);
    URL.revokeObjectURL(url);
  }).catch(err => {
    console.error('Download failed:', err);
    // Fallback to default location
    chrome.downloads.download({
      url: url,
      filename: `scamometer_reports/scamometer_report_${Date.now()}.html`,
      saveAs: false
    }).then(() => {
      showToast('✅ Interactive HTML report downloaded!');
      URL.revokeObjectURL(url);
    });
  });
}

async function exportJsonReport() {
  // Get the batch folder name from queue
  const data = await chrome.storage.local.get('batch::queue');
  const queue = data['batch::queue'];
  const batchFolderName = queue?.batchFolderName || `scamometer-reports-${Date.now()}`;
  
  const json = JSON.stringify({
    generated: new Date().toISOString(),
    total: batchResults.length,
    completed: batchResults.filter(r => r.status === 'completed').length,
    failed: batchResults.filter(r => r.status === 'failed').length,
    results: batchResults
  }, null, 2);
  
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  // Use chrome.downloads API to save to batch folder
  chrome.downloads.download({
    url: url,
    filename: `${batchFolderName}/scamometer_report.json`,
    saveAs: false
  }).then(() => {
    showToast(`✅ JSON report downloaded to ${batchFolderName} folder!`);
    URL.revokeObjectURL(url);
  }).catch(err => {
    console.error('Download failed:', err);
    showToast('JSON report downloaded');
  });
}

function generateInteractiveReport() {
  const completed = batchResults.filter(r => r.status === 'completed' && r.result);
  const failed = batchResults.filter(r => r.status === 'failed');
  const avgScore = completed.length > 0
    ? Math.round(completed.reduce((sum, r) => sum + (r.result.ai?.scamometer || 0), 0) / completed.length)
    : 0;
  
  const highRisk = completed.filter(r => r.result.ai?.scamometer >= 75).length;
  const mediumRisk = completed.filter(r => r.result.ai?.scamometer >= 40 && r.result.ai?.scamometer < 75).length;
  const lowRisk = completed.filter(r => r.result.ai?.scamometer < 40).length;
  
  const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  
  // Helper function to format threat category for display
  const formatThreatCategory = (category) => {
    if (!category || category === 'null') return 'N/A';
    return category.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };
  
  // Serialize results data for JavaScript
  const resultsData = JSON.stringify(batchResults.map((result, index) => {
    const score = result.result?.ai?.scamometer || 0;
    const verdict = result.result?.ai?.verdict || (result.status === 'failed' ? 'Failed' : 'N/A');
    const positives = result.result?.ai?.positives || [];
    const negatives = result.result?.ai?.negatives || [];
    const threatCategory = result.result?.ai?.threatCategory || null;
    const description = result.result?.ai?.description || '';
    const timestamp = result.screenshot?.timestamp || new Date().toISOString();
    const sha256 = result.screenshot?.hash || 'N/A';
    const screenshotFile = result.screenshot?.relativePath || result.screenshot?.filename || null;
    
    return {
      index,
      url: result.url,
      score,
      verdict,
      positives,
      negatives,
      threatCategory,
      description,
      timestamp,
      sha256,
      screenshotFile,
      status: result.status
    };
  }));
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Scamometer Batch Analysis Report - ${new Date().toLocaleDateString()}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      min-height: 100vh;
      padding: 20px;
      color: #e2e8f0;
    }
    
    .container {
      max-width: 1800px;
      margin: 0 auto;
      background: #0f172a;
      border-radius: 20px;
      box-shadow: 0 25px 80px rgba(0,0,0,0.5);
      overflow: hidden;
    }
    
    .header {
      background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
      color: white;
      padding: 48px 40px;
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    
    .header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: url('data:image/svg+xml,<svg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"><g fill="none" fill-rule="evenodd"><g fill="%23ffffff" fill-opacity="0.05"><path d="M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z"/></g></g></svg>') repeat;
      opacity: 0.3;
    }
    
    .header-content {
      position: relative;
      z-index: 1;
    }
    
    .header h1 {
      font-size: 42px;
      font-weight: 800;
      margin-bottom: 12px;
      text-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    
    .header p {
      opacity: 0.95;
      font-size: 18px;
      font-weight: 500;
    }
    
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 24px;
      padding: 40px;
      background: #1e293b;
      border-bottom: 2px solid #334155;
    }
    
    .card {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      padding: 28px;
      border-radius: 16px;
      text-align: center;
      border: 2px solid #334155;
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }
    
    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #3b82f6, #8b5cf6);
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    
    .card:hover {
      transform: translateY(-4px);
      border-color: #3b82f6;
      box-shadow: 0 12px 32px rgba(59, 130, 246, 0.2);
    }
    
    .card:hover::before {
      opacity: 1;
    }
    
    .card-value {
      font-size: 44px;
      font-weight: 800;
      margin-bottom: 10px;
      line-height: 1;
    }
    
    .card.total .card-value { color: #3b82f6; }
    .card.success .card-value { color: #10b981; }
    .card.failed .card-value { color: #ef4444; }
    .card.avg .card-value { color: #f59e0b; }
    .card.high-risk .card-value { color: #ef4444; }
    .card.medium-risk .card-value { color: #f59e0b; }
    .card.low-risk .card-value { color: #10b981; }
    
    .card-label {
      color: #94a3b8;
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }
    
    .controls-bar {
      background: #1e293b;
      padding: 24px 40px;
      border-bottom: 2px solid #334155;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    
    .search-box {
      flex: 1;
      min-width: 280px;
      max-width: 500px;
      position: relative;
    }
    
    .search-box input {
      width: 100%;
      padding: 14px 20px 14px 48px;
      border: 2px solid #334155;
      border-radius: 12px;
      background: #0f172a;
      color: #e2e8f0;
      font-size: 15px;
      transition: all 0.3s ease;
    }
    
    .search-box input:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
    }
    
    .search-box::before {
      content: '🔍';
      position: absolute;
      left: 18px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 18px;
    }
    
    .controls-group {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    
    .btn {
      padding: 12px 20px;
      border-radius: 10px;
      border: 2px solid #334155;
      background: #0f172a;
      color: #e2e8f0;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 14px;
      white-space: nowrap;
    }
    
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(59, 130, 246, 0.3);
    }
    
    .btn.active {
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-color: transparent;
      color: white;
    }
    
    .btn.primary {
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-color: transparent;
      color: white;
    }
    
    .btn.primary:hover {
      box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4);
    }
    
    .sort-controls {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    
    .sort-controls label {
      color: #94a3b8;
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .sort-controls select {
      padding: 10px 16px;
      border-radius: 8px;
      border: 2px solid #334155;
      background: #0f172a;
      color: #e2e8f0;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    
    .sort-controls select:focus {
      outline: none;
      border-color: #3b82f6;
    }
    
    .table-container {
      padding: 40px;
      overflow-x: auto;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      background: #0f172a;
      border-radius: 12px;
      overflow: hidden;
    }
    
    thead {
      background: linear-gradient(135deg, #1e293b, #334155);
    }
    
    th {
      padding: 18px 16px;
      text-align: left;
      font-weight: 700;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #cbd5e1;
      border-bottom: 2px solid #3b82f6;
    }
    
    tbody tr {
      border-bottom: 1px solid #1e293b;
      transition: all 0.2s ease;
    }
    
    tbody tr.result-row {
      cursor: pointer;
    }
    
    tbody tr.result-row:hover {
      background: #1e293b;
      box-shadow: inset 4px 0 0 #3b82f6;
    }
    
    .result-row.low { border-left: 4px solid #10b981; }
    .result-row.medium { border-left: 4px solid #f59e0b; }
    .result-row.high { border-left: 4px solid #ef4444; }
    
    td {
      padding: 18px 16px;
      font-size: 14px;
      vertical-align: middle;
    }
    
    .url-cell {
      max-width: 400px;
      word-break: break-all;
      font-weight: 500;
      color: #e2e8f0;
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 13px;
    }
    
    .date-cell {
      white-space: nowrap;
      color: #94a3b8;
      font-size: 13px;
    }
    
    .description-cell {
      max-width: 300px;
      color: #cbd5e1;
      font-size: 13px;
      line-height: 1.5;
    }
    
    .threat-category {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .threat-category.phishing { background: #7c2d12; color: #fca5a5; border: 1px solid #dc2626; }
    .threat-category.brand_impersonation { background: #713f12; color: #fcd34d; border: 1px solid #f59e0b; }
    .threat-category.typosquatting { background: #831843; color: #fbcfe8; border: 1px solid #ec4899; }
    .threat-category.scareware { background: #7c2d12; color: #fca5a5; border: 1px solid #dc2626; }
    .threat-category.financial_fraud { background: #831843; color: #fbcfe8; border: 1px solid #ec4899; }
    .threat-category.malware_distribution { background: #7c2d12; color: #fca5a5; border: 1px solid #dc2626; }
    .threat-category.fake_shop { background: #713f12; color: #fcd34d; border: 1px solid #f59e0b; }
    .threat-category.tech_support_scam { background: #7c2d12; color: #fca5a5; border: 1px solid #dc2626; }
    .threat-category.survey_scam { background: #713f12; color: #fcd34d; border: 1px solid #f59e0b; }
    .threat-category.credential_harvesting { background: #7c2d12; color: #fca5a5; border: 1px solid #dc2626; }
    .threat-category.social_engineering { background: #831843; color: #fbcfe8; border: 1px solid #ec4899; }
    .threat-category.suspicious_redirect { background: #713f12; color: #fcd34d; border: 1px solid #f59e0b; }
    .threat-category.data_harvesting { background: #713f12; color: #fcd34d; border: 1px solid #f59e0b; }
    .threat-category.other { background: #374151; color: #9ca3af; border: 1px solid #6b7280; }
    .threat-category.na { background: #1e293b; color: #64748b; border: 1px solid #334155; }
    
    .hash-cell code {
      background: #1e293b;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
      color: #94a3b8;
      font-family: 'Monaco', 'Courier New', monospace;
      border: 1px solid #334155;
    }
    
    .score-badge {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 20px;
      font-weight: 800;
      font-size: 16px;
      min-width: 60px;
      text-align: center;
    }
    
    .score-badge.low { 
      background: linear-gradient(135deg, #065f46, #059669);
      color: #d1fae5;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
    }
    .score-badge.medium { 
      background: linear-gradient(135deg, #92400e, #d97706);
      color: #fef3c7;
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
    }
    .score-badge.high { 
      background: linear-gradient(135deg, #991b1b, #dc2626);
      color: #fee2e2;
      box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
    }
    
    .verdict-cell {
      font-weight: 700;
      font-size: 14px;
    }
    
    .screenshot-cell {
      text-align: center;
    }
    
    .screenshot-thumbnail {
      width: 60px;
      height: 40px;
      object-fit: cover;
      border-radius: 6px;
      border: 2px solid #334155;
      cursor: pointer;
      transition: all 0.3s ease;
      display: inline-block;
    }
    
    .screenshot-thumbnail:hover {
      transform: scale(1.1);
      border-color: #3b82f6;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
    }
    
    .view-btn {
      padding: 6px 12px;
      border-radius: 6px;
      border: 2px solid #3b82f6;
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(139, 92, 246, 0.15));
      color: #60a5fa;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
      margin-top: 4px;
    }
    
    .view-btn:hover {
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-color: #8b5cf6;
      color: white;
      transform: translateY(-2px);
      box-shadow: 0 4px 16px rgba(59, 130, 246, 0.6);
    }
    
    .view-btn:active {
      transform: translateY(0);
    }
    
    /* Modal overlay for screenshot */
    .screenshot-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.95);
      z-index: 10000;
      align-items: center;
      justify-content: center;
      padding: 20px;
      backdrop-filter: blur(12px);
      animation: fadeIn 0.25s ease;
    }
    
    .screenshot-overlay.active {
      display: flex;
    }
    
    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    
    .screenshot-modal {
      position: relative;
      max-width: 95vw;
      max-height: 95vh;
      background: #0f172a;
      border-radius: 16px;
      box-shadow: 0 25px 80px rgba(0, 0, 0, 0.9);
      border: 2px solid #334155;
      animation: zoomIn 0.25s ease;
      display: flex;
      flex-direction: column;
    }
    
    @keyframes zoomIn {
      from {
        transform: scale(0.9);
        opacity: 0;
      }
      to {
        transform: scale(1);
        opacity: 1;
      }
    }
    
    .screenshot-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 24px;
      border-bottom: 2px solid #334155;
      background: linear-gradient(135deg, #1e293b, #0f172a);
    }
    
    .screenshot-modal-title {
      font-size: 18px;
      font-weight: 800;
      color: #e2e8f0;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .screenshot-modal-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    
    .modal-action-btn {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      border: 2px solid #334155;
      background: #1e293b;
      color: #94a3b8;
      font-size: 18px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    
    .modal-action-btn:hover {
      border-color: #3b82f6;
      background: #3b82f6;
      color: white;
      transform: translateY(-2px);
    }
    
    .modal-action-btn.download:hover {
      border-color: #10b981;
      background: #10b981;
    }
    
    .modal-action-btn.close:hover {
      border-color: #ef4444;
      background: #ef4444;
      transform: rotate(90deg);
    }
    
    .screenshot-modal-body {
      flex: 1;
      overflow: auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      background: #000000;
    }
    
    .screenshot-modal-image {
      max-width: 100%;
      max-height: calc(95vh - 200px);
      width: auto;
      height: auto;
      border-radius: 8px;
      border: 2px solid #334155;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.8);
      cursor: zoom-in;
      transition: transform 0.3s ease;
    }
    
    .screenshot-modal-image.zoomed {
      cursor: zoom-out;
      transform: scale(1.5);
    }
    
    .screenshot-modal-footer {
      padding: 16px 24px;
      border-top: 2px solid #334155;
      background: #0f172a;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    
    .screenshot-modal-info {
      flex: 1;
      font-size: 13px;
      color: #94a3b8;
    }
    
    .screenshot-modal-info strong {
      color: #e2e8f0;
      font-weight: 700;
    }
    
    .screenshot-modal-hint {
      font-size: 12px;
      color: #64748b;
      font-style: italic;
    }
    
    .indicator-badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 12px;
      font-weight: 700;
      font-size: 13px;
      min-width: 40px;
      text-align: center;
    }
    
    .indicator-badge.pos {
      background: linear-gradient(135deg, #065f46, #059669);
      color: #d1fae5;
    }
    
    .indicator-badge.neg {
      background: linear-gradient(135deg, #991b1b, #dc2626);
      color: #fee2e2;
    }
    
    .indicator-badge.zero {
      background: #1e293b;
      color: #64748b;
      border: 1px solid #334155;
    }
    
    .details-row {
      background: #1e293b !important;
      cursor: default !important;
    }
    
    .details-row:hover {
      box-shadow: none !important;
    }
    
    .details-cell {
      padding: 32px !important;
    }
    
    .details-content {
      background: #0f172a;
      border-radius: 12px;
      padding: 28px;
      border: 2px solid #334155;
    }
    
    .details-section {
      margin-bottom: 24px;
    }
    
    .details-section:last-child {
      margin-bottom: 0;
    }
    
    .details-section h4 {
      font-size: 16px;
      font-weight: 800;
      margin-bottom: 16px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
    }
    
    .details-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
    }
    
    .detail-item {
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .detail-item.positive {
      background: linear-gradient(135deg, #065f46, #047857);
      color: #d1fae5;
      border: 1px solid #059669;
    }
    
    .detail-item.negative {
      background: linear-gradient(135deg, #991b1b, #b91c1c);
      color: #fee2e2;
      border: 1px solid #dc2626;
    }
    
    .detail-item-icon {
      font-size: 16px;
    }
    
    .pagination {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 8px;
      padding: 32px 40px;
      background: #1e293b;
      border-top: 2px solid #334155;
    }
    
    .pagination-btn {
      padding: 10px 16px;
      border-radius: 8px;
      border: 2px solid #334155;
      background: #0f172a;
      color: #e2e8f0;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 14px;
      min-width: 44px;
      text-align: center;
    }
    
    .pagination-btn:hover:not(:disabled) {
      border-color: #3b82f6;
      background: #1e293b;
      transform: translateY(-2px);
    }
    
    .pagination-btn.active {
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-color: transparent;
      color: white;
    }
    
    .pagination-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    
    .pagination-info {
      color: #94a3b8;
      font-size: 14px;
      font-weight: 600;
      margin: 0 16px;
    }
    
    .footer {
      text-align: center;
      padding: 40px;
      background: #0f172a;
      color: #64748b;
      border-top: 2px solid #1e293b;
    }
    
    .footer h3 {
      color: #cbd5e1;
      margin-bottom: 10px;
      font-size: 20px;
      font-weight: 800;
    }
    
    .footer p {
      margin: 8px 0;
      font-size: 14px;
    }
    
    .footer a {
      color: #3b82f6;
      text-decoration: none;
      font-weight: 600;
      transition: color 0.2s ease;
    }
    
    .footer a:hover {
      color: #60a5fa;
    }
    
    .na-text {
      color: #64748b;
      font-style: italic;
      font-size: 13px;
    }
    
    @media (max-width: 1400px) {
      table {
        font-size: 13px;
      }
      th, td {
        padding: 14px 12px;
      }
      .url-cell {
        max-width: 300px;
      }
      .description-cell {
        max-width: 200px;
      }
    }
    
    @media (max-width: 1000px) {
      .controls-bar {
        flex-direction: column;
      }
      .search-box {
        max-width: none;
      }
      .summary-cards {
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      }
    }
    
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .controls-bar, .view-btn, .pagination {
        display: none;
      }
      .screenshot-modal {
        display: block !important;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-content">
        <h1>🧪 Scamometer Batch Analysis Report</h1>
        <p>Generated on ${new Date().toLocaleString()} • Professional Security Assessment</p>
      </div>
    </div>
    
    <div class="summary-cards">
      <div class="card total">
        <div class="card-value">${batchResults.length}</div>
        <div class="card-label">Total URLs</div>
      </div>
      <div class="card success">
        <div class="card-value">${completed.length}</div>
        <div class="card-label">Completed</div>
      </div>
      <div class="card failed">
        <div class="card-value">${failed.length}</div>
        <div class="card-label">Failed</div>
      </div>
      <div class="card avg">
        <div class="card-value">${avgScore}</div>
        <div class="card-label">Avg Risk Score</div>
      </div>
      <div class="card high-risk">
        <div class="card-value">${highRisk}</div>
        <div class="card-label">High Risk</div>
      </div>
      <div class="card medium-risk">
        <div class="card-value">${mediumRisk}</div>
        <div class="card-label">Medium Risk</div>
      </div>
      <div class="card low-risk">
        <div class="card-value">${lowRisk}</div>
        <div class="card-label">Low Risk</div>
      </div>
    </div>
    
    <div class="controls-bar">
      <div class="search-box">
        <input type="text" id="searchBox" placeholder="Search by URL, category, or description..." onkeyup="applyFilters()">
      </div>
      <div class="controls-group">
        <div class="sort-controls">
          <label>Sort:</label>
          <select id="sortSelect" onchange="applyFilters()">
            <option value="url-asc">URL (A-Z)</option>
            <option value="url-desc">URL (Z-A)</option>
            <option value="score-desc">Threat Score (High-Low)</option>
            <option value="score-asc">Threat Score (Low-High)</option>
            <option value="time-desc">Detection Time (Latest)</option>
            <option value="time-asc">Detection Time (Oldest)</option>
          </select>
        </div>
        <button class="btn active" data-filter="all" onclick="setRiskFilter('all')">All</button>
        <button class="btn" data-filter="low" onclick="setRiskFilter('low')">Low Risk</button>
        <button class="btn" data-filter="medium" onclick="setRiskFilter('medium')">Medium Risk</button>
        <button class="btn" data-filter="high" onclick="setRiskFilter('high')">High Risk</button>
        <button class="btn primary" onclick="exportAsJSON()">📥 Export JSON</button>
      </div>
    </div>
    
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th style="width: 30%;">URL</th>
            <th style="width: 12%;">Detection Time</th>
            <th style="width: 18%;">Description</th>
            <th style="width: 10%;">Threat Category</th>
            <th style="width: 8%;">Score</th>
            <th style="width: 8%;">Positives</th>
            <th style="width: 8%;">Negatives</th>
            <th style="width: 6%;">Actions</th>
          </tr>
        </thead>
        <tbody id="resultsTableBody">
          <!-- Populated by JavaScript -->
        </tbody>
      </table>
    </div>
    
    <div class="pagination" id="pagination">
      <!-- Populated by JavaScript -->
    </div>
    
    <div class="footer">
      <h3>🧪 Scamometer</h3>
      <p>AI-Powered Phishing & Scam Detector with Advanced Threat Classification</p>
      <p style="margin-top:12px; font-size:12px;">
        Built by Arnab Mandal | 
        <a href="https://github.com/vio137/scamometer" target="_blank">GitHub</a> |
        <a href="mailto:hello@arnabmandal.com">Contact</a>
      </p>
    </div>
  </div>
  
  <!-- Screenshot Modal Overlay -->
  <div id="screenshotOverlay" class="screenshot-overlay" onclick="closeScreenshotModal(event)">
    <div class="screenshot-modal" onclick="event.stopPropagation()">
      <div class="screenshot-modal-header">
        <div class="screenshot-modal-title">
          <span>📸</span>
          <span id="screenshotModalTitle">Screenshot</span>
        </div>
        <div class="screenshot-modal-actions">
          <button class="modal-action-btn download" onclick="downloadScreenshot()" title="Download Screenshot">
            ⬇
          </button>
          <button class="modal-action-btn close" onclick="closeScreenshotModal()" title="Close (Esc)">
            ×
          </button>
        </div>
      </div>
      <div class="screenshot-modal-body">
        <img id="screenshotModalImage" class="screenshot-modal-image" src="" alt="Screenshot" onclick="toggleZoom()">
      </div>
      <div class="screenshot-modal-footer">
        <div class="screenshot-modal-info">
          <div><strong>URL:</strong> <span id="screenshotModalUrl"></span></div>
          <div style="margin-top:4px;"><strong>Threat Score:</strong> <span id="screenshotModalScore"></span></div>
        </div>
        <div class="screenshot-modal-hint">
          💡 Click image to zoom • Press Esc to close
        </div>
      </div>
    </div>
  </div>
  
  <script>
    // Global state
    let allResults = ${resultsData};
    let filteredResults = [...allResults];
    let currentPage = 1;
    const resultsPerPage = 50;
    let currentRiskFilter = 'all';
    
    // Initialize on load
    document.addEventListener('DOMContentLoaded', () => {
      applyFilters();
    });
    
    // Apply all filters and sorting
    function applyFilters() {
      const searchTerm = document.getElementById('searchBox').value.toLowerCase();
      const sortBy = document.getElementById('sortSelect').value;
      
      // Filter by search
      filteredResults = allResults.filter(result => {
        const matchesSearch = !searchTerm || 
          result.url.toLowerCase().includes(searchTerm) ||
          (result.description || '').toLowerCase().includes(searchTerm) ||
          (result.threatCategory || '').toLowerCase().includes(searchTerm);
        
        // Filter by risk level
        const scoreClass = result.score >= 75 ? 'high' : (result.score >= 40 ? 'medium' : 'low');
        const matchesRiskFilter = currentRiskFilter === 'all' || scoreClass === currentRiskFilter;
        
        return matchesSearch && matchesRiskFilter;
      });
      
      // Sort results
      filteredResults.sort((a, b) => {
        switch (sortBy) {
          case 'url-asc':
            return a.url.localeCompare(b.url);
          case 'url-desc':
            return b.url.localeCompare(a.url);
          case 'score-desc':
            return b.score - a.score;
          case 'score-asc':
            return a.score - b.score;
          case 'time-desc':
            return new Date(b.timestamp) - new Date(a.timestamp);
          case 'time-asc':
            return new Date(a.timestamp) - new Date(b.timestamp);
          default:
            return 0;
        }
      });
      
      currentPage = 1;
      renderTable();
      renderPagination();
    }
    
    // Set risk filter
    function setRiskFilter(filter) {
      currentRiskFilter = filter;
      
      // Update button styles
      document.querySelectorAll('[data-filter]').forEach(btn => {
        if (btn.dataset.filter === filter) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
      
      applyFilters();
    }
    
    // Render table for current page
    function renderTable() {
      const tbody = document.getElementById('resultsTableBody');
      const startIdx = (currentPage - 1) * resultsPerPage;
      const endIdx = startIdx + resultsPerPage;
      const pageResults = filteredResults.slice(startIdx, endIdx);
      
      if (pageResults.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:60px; color:#64748b; font-style:italic;">No results found matching your criteria</td></tr>';
        return;
      }
      
      tbody.innerHTML = pageResults.map(result => {
        const scoreClass = result.score >= 75 ? 'high' : (result.score >= 40 ? 'medium' : 'low');
        const dateFormatted = new Date(result.timestamp).toLocaleString();
        const threatCategoryFormatted = formatThreatCategory(result.threatCategory);
        const threatCategoryClass = (result.threatCategory || 'na').toLowerCase();
        
        return \`
          <tr class="result-row \${scoreClass}" onclick="toggleDetails(\${result.index})">
            <td class="url-cell">\${escapeHtml(result.url)}</td>
            <td class="date-cell">\${escapeHtml(dateFormatted)}</td>
            <td class="description-cell">\${escapeHtml(result.description || 'No description available')}</td>
            <td><span class="threat-category \${threatCategoryClass}">\${escapeHtml(threatCategoryFormatted)}</span></td>
            <td><span class="score-badge \${scoreClass}">\${Math.round(result.score)}</span></td>
            <td>
              \${result.positives.length > 0 ? 
                \`<span class="indicator-badge pos">✓ \${result.positives.length}</span>\` : 
                '<span class="indicator-badge zero">0</span>'}
            </td>
            <td>
              \${result.negatives.length > 0 ? 
                \`<span class="indicator-badge neg">✗ \${result.negatives.length}</span>\` : 
                '<span class="indicator-badge zero">0</span>'}
            </td>
            <td class="screenshot-cell" onclick="event.stopPropagation();">
              \${result.screenshotFile ? 
                \`<div style="display:flex; flex-direction:column; align-items:center; gap:6px;">
                  <img src="./\${result.screenshotFile}" 
                       class="screenshot-thumbnail" 
                       onclick="openScreenshotModal(\${result.index})"
                       alt="Screenshot thumbnail"
                       title="Click to view full size">
                  <button class="view-btn" onclick="openScreenshotModal(\${result.index})">
                    <span>🔍</span>
                    <span>View</span>
                  </button>
                </div>\` : 
                '<span class="na-text">N/A</span>'}
            </td>
          </tr>
          <tr id="details-\${result.index}" class="details-row" style="display:none;">
            <td colspan="8" class="details-cell">
              <div class="details-content">
                <div class="details-section">
                  <h4 style="color:#10b981;">✅ Positive Indicators (\${result.positives.length})</h4>
                  \${result.positives.length > 0 ? \`
                    <div class="details-grid">
                      \${result.positives.map(p => \`<div class="detail-item positive"><span class="detail-item-icon">✓</span><span>\${escapeHtml(p)}</span></div>\`).join('')}
                    </div>
                  \` : '<p class="na-text">No positive indicators found</p>'}
                </div>
                <div class="details-section">
                  <h4 style="color:#ef4444;">🚩 Red Flags (\${result.negatives.length})</h4>
                  \${result.negatives.length > 0 ? \`
                    <div class="details-grid">
                      \${result.negatives.map(n => \`<div class="detail-item negative"><span class="detail-item-icon">✗</span><span>\${escapeHtml(n)}</span></div>\`).join('')}
                    </div>
                  \` : '<p class="na-text">No red flags found</p>'}
                </div>
                <div class="details-section">
                  <h4 style="color:#8b5cf6;">🔐 SHA-256 Hash</h4>
                  <code style="background:#1e293b; padding:12px 16px; border-radius:8px; display:block; color:#94a3b8; font-size:12px; border:1px solid #334155;">\${escapeHtml(result.sha256)}</code>
                </div>
              </div>
            </td>
          </tr>
        \`;
      }).join('');
    }
    
    // Render pagination controls
    function renderPagination() {
      const totalPages = Math.ceil(filteredResults.length / resultsPerPage);
      const pagination = document.getElementById('pagination');
      
      if (totalPages <= 1) {
        pagination.style.display = 'none';
        return;
      }
      
      pagination.style.display = 'flex';
      
      let html = '';
      
      // Previous button
      html += \`<button class="pagination-btn" onclick="changePage(\${currentPage - 1})" \${currentPage === 1 ? 'disabled' : ''}>← Prev</button>\`;
      
      // Page numbers
      const maxButtons = 7;
      let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
      let endPage = Math.min(totalPages, startPage + maxButtons - 1);
      
      if (endPage - startPage < maxButtons - 1) {
        startPage = Math.max(1, endPage - maxButtons + 1);
      }
      
      if (startPage > 1) {
        html += \`<button class="pagination-btn" onclick="changePage(1)">1</button>\`;
        if (startPage > 2) {
          html += '<span class="pagination-info">...</span>';
        }
      }
      
      for (let i = startPage; i <= endPage; i++) {
        html += \`<button class="pagination-btn \${i === currentPage ? 'active' : ''}" onclick="changePage(\${i})">\${i}</button>\`;
      }
      
      if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
          html += '<span class="pagination-info">...</span>';
        }
        html += \`<button class="pagination-btn" onclick="changePage(\${totalPages})">\${totalPages}</button>\`;
      }
      
      // Next button
      html += \`<button class="pagination-btn" onclick="changePage(\${currentPage + 1})" \${currentPage === totalPages ? 'disabled' : ''}>Next →</button>\`;
      
      // Info
      const startIdx = (currentPage - 1) * resultsPerPage + 1;
      const endIdx = Math.min(currentPage * resultsPerPage, filteredResults.length);
      html += \`<span class="pagination-info">Showing \${startIdx}-\${endIdx} of \${filteredResults.length}</span>\`;
      
      pagination.innerHTML = html;
    }
    
    // Change page
    function changePage(page) {
      const totalPages = Math.ceil(filteredResults.length / resultsPerPage);
      if (page < 1 || page > totalPages) return;
      
      currentPage = page;
      renderTable();
      renderPagination();
      
      // Scroll to top of table
      document.querySelector('.table-container').scrollIntoView({ behavior: 'smooth' });
    }
    
    // Toggle details row
    function toggleDetails(index) {
      const detailsRow = document.getElementById('details-' + index);
      if (!detailsRow) return;
      
      if (detailsRow.style.display === 'none' || detailsRow.style.display === '') {
        // Close all other details
        document.querySelectorAll('.details-row').forEach(row => row.style.display = 'none');
        detailsRow.style.display = 'table-row';
      } else {
        detailsRow.style.display = 'none';
      }
    }
    
    // Open screenshot in modal
    let currentScreenshotUrl = '';
    
    function openScreenshotModal(index) {
      const result = allResults.find(r => r.index === index);
      if (!result || !result.screenshotFile) return;
      
      currentScreenshotUrl = './' + result.screenshotFile;
      
      // Set modal content
      const imgElement = document.getElementById('screenshotModalImage');
      imgElement.src = currentScreenshotUrl;
      imgElement.classList.remove('zoomed');
      
      document.getElementById('screenshotModalTitle').textContent = 'Screenshot - ' + result.url.substring(0, 40) + (result.url.length > 40 ? '...' : '');
      document.getElementById('screenshotModalUrl').textContent = result.url;
      
      const scoreClass = result.score >= 75 ? 'High Risk' : (result.score >= 40 ? 'Medium Risk' : 'Low Risk');
      const scoreColor = result.score >= 75 ? '#ef4444' : (result.score >= 40 ? '#f59e0b' : '#10b981');
      document.getElementById('screenshotModalScore').innerHTML = \`<span style="color:\${scoreColor}; font-weight:800;">\${Math.round(result.score)}/100 (\${scoreClass})</span>\`;
      
      // Show modal
      document.getElementById('screenshotOverlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }
    
    // Close screenshot modal
    function closeScreenshotModal(event) {
      // Only close if clicking overlay or close button
      if (event && event.target.closest('.screenshot-modal') && 
          !event.target.classList.contains('close') &&
          event.target.id !== 'screenshotOverlay') {
        return;
      }
      
      document.getElementById('screenshotOverlay').classList.remove('active');
      document.body.style.overflow = 'auto';
      
      // Reset zoom
      const imgElement = document.getElementById('screenshotModalImage');
      imgElement.classList.remove('zoomed');
    }
    
    // Toggle zoom on screenshot
    function toggleZoom() {
      const imgElement = document.getElementById('screenshotModalImage');
      imgElement.classList.toggle('zoomed');
    }
    
    // Download screenshot
    function downloadScreenshot() {
      if (!currentScreenshotUrl) return;
      
      const link = document.createElement('a');
      link.href = currentScreenshotUrl;
      link.download = 'scamometer-screenshot-' + Date.now() + '.png';
      link.click();
    }
    
    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeScreenshotModal();
      }
    });
    
    // Format threat category for display
    function formatThreatCategory(category) {
      if (!category || category === 'null' || category === null) return 'N/A';
      return category.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    }
    
    // Escape HTML
    function escapeHtml(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
    
    // Export as JSON
    function exportAsJSON() {
      const data = {
        generated: new Date().toISOString(),
        total: allResults.length,
        completed: allResults.filter(r => r.status === 'completed').length,
        failed: allResults.filter(r => r.status === 'failed').length,
        avgScore: ${avgScore},
        results: allResults
      };
      
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'scamometer-report-' + Date.now() + '.json';
      a.click();
      URL.revokeObjectURL(url);
    }
  </script>
</body>
</html>`;
}
function generateDetailReport(result) {
  const score = result.result?.ai?.scamometer || 0;
  const scoreClass = score >= 75 ? 'high' : (score >= 40 ? 'medium' : 'low');
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Scamometer Report - ${escapeHtml(result.url)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0b1020;
      color: #e2e8f0;
      padding: 24px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 40px;
      border-radius: 16px;
      margin-bottom: 24px;
      text-align: center;
    }
    .score-display {
      font-size: 72px;
      font-weight: 700;
      margin: 24px 0;
    }
    .score-display.low { color: #10b981; }
    .score-display.medium { color: #f59e0b; }
    .score-display.high { color: #ef4444; }
    .card {
      background: #0f172a;
      border: 1px solid #1f2937;
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
    }
    .card h2 {
      color: #06b6d4;
      margin-bottom: 16px;
    }
    .url-display {
      word-break: break-all;
      background: #0b1020;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 16px;
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .tag {
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 13px;
    }
    .tag.pos {
      background: rgba(16, 185, 129, 0.2);
      color: #10b981;
      border: 1px solid #10b981;
    }
    .tag.neg {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
      border: 1px solid #ef4444;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🧪 Scamometer Security Report</h1>
      <div class="score-display ${scoreClass}">${Math.round(score)}/100</div>
      <div>${escapeHtml(result.result?.ai?.verdict || 'Unknown')}</div>
    </div>
    
    <div class="card">
      <h2>URL</h2>
      <div class="url-display">${escapeHtml(result.url)}</div>
    </div>
    
    <div class="card">
      <h2>Analysis</h2>
      <p>${escapeHtml(result.result?.ai?.reason || 'No analysis available')}</p>
    </div>
    
    <div class="card">
      <h2>Positive Indicators</h2>
      <div class="tags">
        ${(result.result?.ai?.positives || []).map(p => `<span class="tag pos">✓ ${escapeHtml(p)}</span>`).join('')}
        ${(result.result?.ai?.positives || []).length === 0 ? '<span style="color: #94a3b8;">None found</span>' : ''}
      </div>
    </div>
    
    <div class="card">
      <h2>Red Flags</h2>
      <div class="tags">
        ${(result.result?.ai?.negatives || []).map(n => `<span class="tag neg">✗ ${escapeHtml(n)}</span>`).join('')}
        ${(result.result?.ai?.negatives || []).length === 0 ? '<span style="color: #94a3b8;">None found</span>' : ''}
      </div>
    </div>
    
    <div style="text-align: center; color: #94a3b8; margin-top: 40px;">
      <p>Generated by Scamometer on ${new Date().toLocaleString()}</p>
    </div>
  </div>
</body>
</html>`;
}

function newBatch() {
  batchUrls = [];
  batchResults = [];
  document.getElementById('uploadSection').style.display = 'block';
  document.getElementById('progressSection').classList.remove('active');
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('csvFile').value = '';
  document.getElementById('fileInfo').style.display = 'none';
  document.getElementById('startBtn').disabled = true;
}

async function checkExistingBatch() {
  const status = await chrome.runtime.sendMessage({ type: 'GET_BATCH_STATUS' });
  if (status && status.status !== 'completed') {
    // Resume existing batch
    document.getElementById('uploadSection').style.display = 'none';
    document.getElementById('progressSection').classList.add('active');
    startPolling();
  } else {
    const results = await chrome.runtime.sendMessage({ type: 'GET_BATCH_RESULTS' });
    if (results && results.results && results.results.length > 0) {
      // Show existing results
      batchResults = results.results;
      await handleBatchComplete();
    }
  }
}

function showApiKeyModal() {
  document.getElementById('apiKeyModal').classList.add('active');
}

async function saveNewApiKey() {
  const newKey = document.getElementById('newApiKey').value.trim();
  if (!newKey) {
    showToast('Please enter an API key', true);
    return;
  }
  
  await chrome.storage.local.set({ apiKey: newKey });
  document.getElementById('apiKeyModal').classList.remove('active');
  document.getElementById('newApiKey').value = '';
  
  // Resume batch
  await chrome.runtime.sendMessage({ type: 'RESUME_BATCH' });
  startPolling();
  showToast('API key updated, resuming batch processing');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m =>
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
    bottom: 24px;
    right: 24px;
    padding: 16px 24px;
    background: ${isError ? '#ef4444' : '#10b981'};
    color: white;
    border-radius: 12px;
    font-weight: 600;
    box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    z-index: 10000;
    animation: slideIn 0.3s ease;
  `;
  
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
