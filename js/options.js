// Built by Arnab Mandal — contact: hello@arnabmandal.com
const MODEL_DEFAULT = 'gemini-2.5-flash';
const CEREBRAS_MODEL_DEFAULT = 'llama-3.3-70b';

async function load() {
  const { 
    globalSystemPrompt,
    whitelist = [], 
    blacklist = [] 
  } = await chrome.storage.local.get({ 
    globalSystemPrompt: '',
    whitelist: [],
    blacklist: []
  });
  
  // Global system prompt (works with all providers)
  document.getElementById('globalSystemPrompt').value = globalSystemPrompt || '';
  
  renderLists(whitelist, blacklist);
  updateStats();
}

function renderLists(whitelist, blacklist) {
  const whitelistEl = document.getElementById('whitelistItems');
  const blacklistEl = document.getElementById('blacklistItems');
  
  whitelistEl.innerHTML = whitelist.map((domain, index) => `
    <div class="list-item">
      <span class="list-item-text">${escapeHtml(domain)}</span>
      <button data-domain="${escapeHtml(domain)}" data-list="whitelist">Remove</button>
    </div>
  `).join('') || '<div class="muted" style="margin-top:8px;">No whitelisted sites</div>';
  
  blacklistEl.innerHTML = blacklist.map((domain, index) => `
    <div class="list-item">
      <span class="list-item-text">${escapeHtml(domain)}</span>
      <button data-domain="${escapeHtml(domain)}" data-list="blacklist">Remove</button>
    </div>
  `).join('') || '<div class="muted" style="margin-top:8px;">No blacklisted sites</div>';
  
  // Add event listeners to remove buttons
  whitelistEl.querySelectorAll('button[data-list="whitelist"]').forEach(btn => {
    btn.addEventListener('click', () => removeFromWhitelist(btn.dataset.domain));
  });
  
  blacklistEl.querySelectorAll('button[data-list="blacklist"]').forEach(btn => {
    btn.addEventListener('click', () => removeFromBlacklist(btn.dataset.domain));
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function updateStats() {
  const data = await chrome.storage.local.get(null);
  const whitelist = data.whitelist || [];
  const blacklist = data.blacklist || [];
  
  let cacheCount = 0;
  let totalSize = 0;
  
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('analysis::')) cacheCount++;
    totalSize += JSON.stringify(value).length;
  }
  
  document.getElementById('cacheCount').textContent = cacheCount;
  document.getElementById('whitelistCount').textContent = whitelist.length;
  document.getElementById('blacklistCount').textContent = blacklist.length;
  document.getElementById('storageUsed').textContent = formatBytes(totalSize);
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Show inline message near input
function showMessage(inputId, message, isError = false) {
  const input = document.getElementById(inputId);
  const existing = input.parentNode.querySelector('.inline-message');
  if (existing) existing.remove();
  
  const msg = document.createElement('div');
  msg.className = 'inline-message';
  msg.textContent = message;
  msg.style.marginTop = '4px';
  msg.style.fontSize = '12px';
  msg.style.color = isError ? 'var(--red)' : 'var(--green)';
  input.parentNode.appendChild(msg);
  
  setTimeout(() => msg.remove(), 3000);
}

// Validate domain format
function isValidDomain(domain) {
  // Basic domain validation
  const domainRegex = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i;
  return domainRegex.test(domain);
}

// Whitelist management
document.getElementById('addWhitelist').addEventListener('click', async () => {
  const input = document.getElementById('whitelistInput');
  const domain = input.value.trim().toLowerCase();
  if (!domain) return;
  
  if (!isValidDomain(domain)) {
    showMessage('whitelistInput', 'Please enter a valid domain (e.g., example.com)', true);
    return;
  }
  
  const { whitelist = [] } = await chrome.storage.local.get({ whitelist: [] });
  if (whitelist.includes(domain)) {
    showMessage('whitelistInput', 'Domain already in whitelist', true);
    return;
  }
  
  whitelist.push(domain);
  await chrome.storage.local.set({ whitelist });
  input.value = '';
  load();
});

async function removeFromWhitelist(domain) {
  const { whitelist = [] } = await chrome.storage.local.get({ whitelist: [] });
  const updated = whitelist.filter(d => d !== domain);
  await chrome.storage.local.set({ whitelist: updated });
  load();
}

// Blacklist management
document.getElementById('addBlacklist').addEventListener('click', async () => {
  const input = document.getElementById('blacklistInput');
  const domain = input.value.trim().toLowerCase();
  if (!domain) return;
  
  if (!isValidDomain(domain)) {
    showMessage('blacklistInput', 'Please enter a valid domain (e.g., example.com)', true);
    return;
  }
  
  const { blacklist = [] } = await chrome.storage.local.get({ blacklist: [] });
  if (blacklist.includes(domain)) {
    showMessage('blacklistInput', 'Domain already in blacklist', true);
    return;
  }
  
  blacklist.push(domain);
  await chrome.storage.local.set({ blacklist });
  input.value = '';
  load();
});

async function removeFromBlacklist(domain) {
  const { blacklist = [] } = await chrome.storage.local.get({ blacklist: [] });
  const updated = blacklist.filter(d => d !== domain);
  await chrome.storage.local.set({ blacklist: updated });
  load();
}

// Clear cache
document.getElementById('clearCache').addEventListener('click', async () => {
  if (!confirm('Clear all cached scan results? This will not affect whitelists or blacklists.')) return;
  
  const data = await chrome.storage.local.get(null);
  const keysToRemove = [];
  
  for (const key of Object.keys(data)) {
    if (key.startsWith('analysis::')) keysToRemove.push(key);
  }
  
  await chrome.storage.local.remove(keysToRemove);
  alert(`Cleared ${keysToRemove.length} cached analyses`);
  updateStats();
});

// Clear all data
document.getElementById('clearAll').addEventListener('click', async () => {
  if (!confirm('⚠️ WARNING: This will delete ALL data including API key, whitelist, blacklist, and cache. Are you absolutely sure?')) return;
  
  await chrome.storage.local.clear();
  alert('All data cleared');
  location.reload();
});

function $(id) { return document.getElementById(id); }
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  return tab;
}
function isIp(host) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || /^[0-9a-f:]+$/i.test(host);
}
function rdapCandidates(host){
  if (!host) return [];
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 1) return [host];
  const cands = [];
  for (let i = Math.max(0, labels.length - 2); i >= 0; i--) {
    const cand = labels.slice(i).join('.');
    if (!cands.includes(cand)) cands.push(cand);
  }
  return cands;
}
async function fetchWithTimeout(url, options = {}, timeout = 12000) {
  const controller = new AbortController(); 
  const id = setTimeout(() => controller.abort(), timeout);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(id); }
}

// DNS Test button
document.getElementById('testDns').addEventListener('click', async () => {
  $('outDns').textContent = 'Fetching…';
  try {
    const tab = await getActiveTab();
    const u = new URL(tab.url);
    const hostname = u.hostname;
    const g = await fetchWithTimeout(`https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`);
    const out = {};
    out.google = g.ok ? await g.json() : { error: 'HTTP '+g.status };
    const cf = await fetchWithTimeout(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { 'accept': 'application/dns-json' }
    });
    out.cloudflare = cf.ok ? await cf.json() : { error: 'HTTP '+cf.status };
    const sample = {
      statusGoogle: out.google.Status, statusCloudflare: out.cloudflare.Status,
      samples: {
        g: (out.google.Answer||[]).slice(0,2),
        cf: (out.cloudflare.Answer||[]).slice(0,2)
      }
    };
    $('outDns').textContent = JSON.stringify(sample, null, 2);
  } catch (e) {
    $('outDns').textContent = 'Error: ' + e.message;
  }
});

// RDAP Test button
document.getElementById('testRdap').addEventListener('click', async () => {
  $('outRdap').textContent = 'Fetching…';
  try {
    const tab = await getActiveTab();
    const u = new URL(tab.url);
    const host = u.hostname;
    if (isIp(host)) {
      const r = await fetchWithTimeout(`https://rdap.org/ip/${encodeURIComponent(host)}`);
      const txt = r.ok ? await r.json() : { error: 'HTTP '+r.status };
      $('outRdap').textContent = JSON.stringify({
        endpoint: 'ip', target: host, keys: Object.keys(txt||{}).slice(0,10)
      }, null, 2);
      return;
    }
    const cands = rdapCandidates(host);
    const out = { tried: cands };
    for (const cand of cands) {
      const r = await fetchWithTimeout(`https://rdap.org/domain/${encodeURIComponent(cand)}`);
      if (r.ok) {
        const j = await r.json();
        out.success = { endpoint:'domain', target:cand, hasLdh: !!j.ldhName, sampleEvents: (j.events||[]).slice(0,2) };
        $('outRdap').textContent = JSON.stringify(out, null, 2);
        return;
      } else {
        out[`HTTP_${cand}`] = r.status;
      }
    }
    $('outRdap').textContent = JSON.stringify(out, null, 2);
  } catch (e) {
    $('outRdap').textContent = 'Error: ' + e.message;
  }
});

// Enter key support for inputs
document.getElementById('whitelistInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('addWhitelist').click();
  }
});

document.getElementById('blacklistInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('addBlacklist').click();
  }
});

// ============================================================================
// DUAL AI CONFIGURATION
// ============================================================================

// Model A provider change handler
document.getElementById('modelA_provider').addEventListener('change', (e) => {
  toggleModelAConfig(e.target.value);
});

// Model B provider change handler
document.getElementById('modelB_provider').addEventListener('change', (e) => {
  toggleModelBConfig(e.target.value);
});

function toggleModelAConfig(provider) {
  const geminiConfig = document.getElementById('modelA_geminiConfig');
  const cerebrasConfig = document.getElementById('modelA_cerebrasConfig');
  const customConfig = document.getElementById('modelA_customConfig');
  
  geminiConfig.style.display = 'none';
  cerebrasConfig.style.display = 'none';
  customConfig.style.display = 'none';
  
  if (provider === 'gemini') {
    geminiConfig.style.display = 'block';
  } else if (provider === 'cerebras') {
    cerebrasConfig.style.display = 'block';
  } else if (provider === 'custom') {
    customConfig.style.display = 'block';
  }
}

function toggleModelBConfig(provider) {
  const geminiConfig = document.getElementById('modelB_geminiConfig');
  const cerebrasConfig = document.getElementById('modelB_cerebrasConfig');
  const customConfig = document.getElementById('modelB_customConfig');
  
  geminiConfig.style.display = 'none';
  cerebrasConfig.style.display = 'none';
  customConfig.style.display = 'none';
  
  if (provider === 'gemini') {
    geminiConfig.style.display = 'block';
  } else if (provider === 'cerebras') {
    cerebrasConfig.style.display = 'block';
  } else if (provider === 'custom') {
    customConfig.style.display = 'block';
  }
}

async function loadDualAIConfig() {
  const config = await chrome.storage.local.get({
    // Model A defaults
    modelA_provider: 'none',
    modelA_apiKey: '',
    modelA_model: 'gemini-2.5-flash',
    modelA_maxTokens: 5000,
    modelA_timeout: 10000,
    modelA_cerebrasApiKey: '',
    modelA_cerebrasModel: 'llama-3.3-70b',
    modelA_customEndpoint: '',
    modelA_customApiKey: '',
    modelA_customModel: '',
    
    // Model B defaults
    modelB_provider: 'gemini',
    modelB_apiKey: '',
    modelB_model: 'gemini-2.5-flash',
    modelB_temperature: 0.2,
    modelB_maxTokens: 2048,
    modelB_cerebrasApiKey: '',
    modelB_cerebrasModel: 'llama-3.3-70b',
    modelB_customEndpoint: '',
    modelB_customApiKey: '',
    modelB_customModel: ''
  });
  
  // Model A
  document.getElementById('modelA_provider').value = config.modelA_provider;
  document.getElementById('modelA_apiKey').value = config.modelA_apiKey || '';
  document.getElementById('modelA_model').value = config.modelA_model;
  document.getElementById('modelA_maxTokens').value = config.modelA_maxTokens;
  document.getElementById('modelA_timeout').value = config.modelA_timeout;
  document.getElementById('modelA_cerebrasApiKey').value = config.modelA_cerebrasApiKey || '';
  document.getElementById('modelA_cerebrasModel').value = config.modelA_cerebrasModel;
  document.getElementById('modelA_customEndpoint').value = config.modelA_customEndpoint || '';
  document.getElementById('modelA_customApiKey').value = config.modelA_customApiKey || '';
  document.getElementById('modelA_customModel').value = config.modelA_customModel || '';
  
  // Model B
  document.getElementById('modelB_provider').value = config.modelB_provider;
  document.getElementById('modelB_apiKey').value = config.modelB_apiKey || '';
  document.getElementById('modelB_model').value = config.modelB_model;
  document.getElementById('modelB_temperature').value = config.modelB_temperature;
  document.getElementById('modelB_maxTokens').value = config.modelB_maxTokens;
  document.getElementById('modelB_cerebrasApiKey').value = config.modelB_cerebrasApiKey || '';
  document.getElementById('modelB_cerebrasModel').value = config.modelB_cerebrasModel;
  document.getElementById('modelB_customEndpoint').value = config.modelB_customEndpoint || '';
  document.getElementById('modelB_customApiKey').value = config.modelB_customApiKey || '';
  document.getElementById('modelB_customModel').value = config.modelB_customModel || '';
  
  // Show correct configs
  toggleModelAConfig(config.modelA_provider);
  toggleModelBConfig(config.modelB_provider);
}

document.getElementById('saveDualAI').addEventListener('click', async () => {
  const modelA_provider = document.getElementById('modelA_provider').value;
  const modelB_provider = document.getElementById('modelB_provider').value;
  
  // Model A validation (only if not 'none')
  if (modelA_provider !== 'none') {
    if (modelA_provider === 'gemini' && !document.getElementById('modelA_apiKey').value.trim()) {
      showDualAIMessage('Model A: Please enter Gemini API key', true);
      return;
    }
    if (modelA_provider === 'cerebras' && !document.getElementById('modelA_cerebrasApiKey').value.trim()) {
      showDualAIMessage('Model A: Please enter Cerebras API key', true);
      return;
    }
    if (modelA_provider === 'custom') {
      if (!document.getElementById('modelA_customEndpoint').value.trim() ||
          !document.getElementById('modelA_customApiKey').value.trim() ||
          !document.getElementById('modelA_customModel').value.trim()) {
        showDualAIMessage('Model A: Please fill in all custom LLM fields', true);
        return;
      }
    }
  }
  
  // Model B validation (required)
  if (modelB_provider === 'gemini' && !document.getElementById('modelB_apiKey').value.trim()) {
    showDualAIMessage('Model B: Please enter Gemini API key', true);
    return;
  }
  if (modelB_provider === 'cerebras' && !document.getElementById('modelB_cerebrasApiKey').value.trim()) {
    showDualAIMessage('Model B: Please enter Cerebras API key', true);
    return;
  }
  if (modelB_provider === 'custom') {
    if (!document.getElementById('modelB_customEndpoint').value.trim() ||
        !document.getElementById('modelB_customApiKey').value.trim() ||
        !document.getElementById('modelB_customModel').value.trim()) {
      showDualAIMessage('Model B: Please fill in all custom LLM fields', true);
      return;
    }
  }
  
  // Save configuration
  await chrome.storage.local.set({
    // Model A
    modelA_provider,
    modelA_apiKey: document.getElementById('modelA_apiKey').value.trim(),
    modelA_model: document.getElementById('modelA_model').value,
    modelA_maxTokens: parseInt(document.getElementById('modelA_maxTokens').value),
    modelA_timeout: parseInt(document.getElementById('modelA_timeout').value),
    modelA_cerebrasApiKey: document.getElementById('modelA_cerebrasApiKey').value.trim(),
    modelA_cerebrasModel: document.getElementById('modelA_cerebrasModel').value,
    modelA_customEndpoint: document.getElementById('modelA_customEndpoint').value.trim(),
    modelA_customApiKey: document.getElementById('modelA_customApiKey').value.trim(),
    modelA_customModel: document.getElementById('modelA_customModel').value.trim(),
    
    // Model B
    modelB_provider,
    modelB_apiKey: document.getElementById('modelB_apiKey').value.trim(),
    modelB_model: document.getElementById('modelB_model').value,
    modelB_temperature: parseFloat(document.getElementById('modelB_temperature').value),
    modelB_maxTokens: parseInt(document.getElementById('modelB_maxTokens').value),
    modelB_cerebrasApiKey: document.getElementById('modelB_cerebrasApiKey').value.trim(),
    modelB_cerebrasModel: document.getElementById('modelB_cerebrasModel').value,
    modelB_customEndpoint: document.getElementById('modelB_customEndpoint').value.trim(),
    modelB_customApiKey: document.getElementById('modelB_customApiKey').value.trim(),
    modelB_customModel: document.getElementById('modelB_customModel').value.trim()
  });
  
  showDualAIMessage('✓ Dual AI configuration saved successfully', false);
});

function showDualAIMessage(message, isError) {
  const s = document.getElementById('dualAIStatus');
  s.textContent = message;
  s.style.color = isError ? '#dc2626' : '#16a34a';
  setTimeout(() => { s.textContent = ''; }, 3000);
}

// ============================================================================
// WEBHOOK CONFIGURATION
// ============================================================================

async function loadWebhookConfig() {
  const { webhookUrl, webhookEnabled, webhookAuth, allowedDomains = [] } = await chrome.storage.local.get({
    webhookUrl: '',
    webhookEnabled: false,
    webhookAuth: '',
    allowedDomains: []
  });
  
  document.getElementById('webhookUrl').value = webhookUrl || '';
  document.getElementById('webhookEnabled').checked = webhookEnabled || false;
  document.getElementById('webhookAuth').value = webhookAuth || '';
  
  renderWebhookDomains(allowedDomains);
}

function renderWebhookDomains(domains) {
  const container = document.getElementById('webhookDomains');
  if (domains.length === 0) {
    container.innerHTML = '<div class="muted" style="margin-top:8px;">No domains whitelisted</div>';
    return;
  }
  
  container.innerHTML = domains.map(domain => `
    <div class="list-item">
      <span class="list-item-text">${escapeHtml(domain)}</span>
      <button onclick="removeWebhookDomain('${escapeHtml(domain)}')">Remove</button>
    </div>
  `).join('');
}

window.removeWebhookDomain = async function(domain) {
  const { allowedDomains = [] } = await chrome.storage.local.get({ allowedDomains: [] });
  const filtered = allowedDomains.filter(d => d !== domain);
  await chrome.storage.local.set({ allowedDomains: filtered });
  renderWebhookDomains(filtered);
  showWebhookMessage('Domain removed', false);
};

document.getElementById('saveWebhook').addEventListener('click', async () => {
  const webhookUrl = document.getElementById('webhookUrl').value.trim();
  const webhookEnabled = document.getElementById('webhookEnabled').checked;
  const webhookAuth = document.getElementById('webhookAuth').value.trim();
  
  // Validate URL if enabled
  if (webhookEnabled) {
    try {
      if (new URL(webhookUrl).protocol !== "https:") throw new Error("HTTPS required");
    } catch (e) {
      showWebhookMessage('A valid HTTPS webhook URL is required', true);
      return;
    }
  }
  
  await chrome.storage.local.set({ webhookUrl, webhookEnabled, webhookAuth });
  showWebhookMessage('Webhook configuration saved', false);
});

document.getElementById('testWebhook').addEventListener('click', async () => {
  const webhookUrl = document.getElementById('webhookUrl').value.trim();
  const webhookAuth = document.getElementById('webhookAuth').value.trim();
  
  if (!webhookUrl) {
    showWebhookMessage('Please enter a webhook URL', true);
    return;
  }
  
  try {
    if (new URL(webhookUrl).protocol !== "https:") throw new Error("HTTPS required");
  } catch (e) {
    showWebhookMessage('A valid HTTPS webhook URL is required', true);
    return;
  }
  
  showWebhookMessage('Testing webhook...', false);
  
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (webhookAuth) {
      headers['Authorization'] = webhookAuth;
    }
    
    const testPayload = {
      test: true,
      timestamp: Date.now(),
      message: 'Scamometer webhook test'
    };
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(testPayload)
    });
    
    if (response.ok) {
      showWebhookMessage(`✓ Webhook test successful (HTTP ${response.status})`, false);
    } else {
      showWebhookMessage(`✗ Webhook test failed (HTTP ${response.status})`, true);
    }
  } catch (error) {
    showWebhookMessage(`✗ Webhook test failed: ${error.message}`, true);
  }
});

document.getElementById('addWebhookDomain').addEventListener('click', async () => {
  const input = document.getElementById('newWebhookDomain');
  const domain = input.value.trim();
  
  if (!domain) return;
  
  // Validate domain URL
  try {
    new URL(domain);
  } catch (e) {
    showWebhookMessage('Invalid domain URL format (e.g., https://example.com)', true);
    return;
  }
  
  const { allowedDomains = [] } = await chrome.storage.local.get({ allowedDomains: [] });
  
  if (allowedDomains.includes(domain)) {
    showWebhookMessage('Domain already whitelisted', true);
    return;
  }
  
  allowedDomains.push(domain);
  await chrome.storage.local.set({ allowedDomains });
  renderWebhookDomains(allowedDomains);
  input.value = '';
  showWebhookMessage('Domain added', false);
});

document.getElementById('newWebhookDomain').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    document.getElementById('addWebhookDomain').click();
  }
});

function showWebhookMessage(message, isError) {
  const container = document.getElementById('webhookStatus');
  container.className = 'status-msg ' + (isError ? 'error' : 'success');
  container.textContent = message;
  container.style.display = 'block';
  setTimeout(() => {
    container.style.display = 'none';
  }, 3000);
}

// Load webhook config on page load
load();
loadDualAIConfig();
loadWebhookConfig();

