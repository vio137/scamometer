// Built by Arnab Mandal — contact: hello@arnabmandal.com

// background.js — updated v2.0 (best-in-class features)

// Import webhook functionality
import { sendWebhookNotification, registerWebhookListener } from './webhook.js';

// Show welcome page on first install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('html/welcome.html') });
  }
  // Register webhook listener
  registerWebhookListener();
});
const SCAM_THRESHOLD = 70;
const DNS_TYPES = ['A','AAAA','CNAME','MX','NS','TXT','SOA','SRV','DNSKEY','DS','CAA'];
const REQUEST_TIMEOUT_MS = 12000;
const MODEL_DEFAULT = 'gemini-2.5-flash';
const DNS_CACHE_TTL = 24*60*60*1000;
const RDAP_CACHE_TTL = 24*60*60*1000;

// Dual AI Configuration Defaults
const MODEL_A_DEFAULT = 'gemini-2.5-flash'; // Summarizer
const MODEL_B_DEFAULT = 'gemini-2.5-flash'; // Judge/Verdict
const PIPELINE_TIMEOUT_MS = 15000;
const ADAPTIVE_TIMEOUT_EXTENSION_MS = 5000;

// In-memory caches for DNS/RDAP results
const dnsCache = {};
const rdapCache = {};

// Generate storage key per URL
function storageKey(url) {
  const u = new URL(url);
  return `analysis::${u.origin}${u.pathname}${u.search}`;
}

// Listen for page loads to auto-run analysis
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url || !/^https?:\/\//i.test(tab.url)) return;
  
  // Check if extension is enabled
  const { enabled = false } = await chrome.storage.local.get({ enabled: false });
  if (!enabled) {
    await setBadge({ text: '', color: '#6b7280' });
    return;
  }
  
  try {
    await runAnalysis(tabId, tab.url, { reason: 'tab_complete' });
  } catch (e) {
    console.warn('Analysis failed:', e);
    await setBadge({ text: 'ERR', color: '#6b7280' });
    progress(tabId, 100, 'Failed');
  }
});

// Batch processing state
let batchProcessingActive = false;
let batchTabId = null;

// Listen for messages from popup or content
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'GET_ANALYSIS_FOR_URL') {
      if (typeof msg.url !== 'string' || !/^https?:\/\//i.test(msg.url)) { sendResponse(null); return; }
      const key = storageKey(msg.url);
      const data = await chrome.storage.local.get(key);
      sendResponse(data[key] || null);
    }
    if (msg?.type === 'RUN_ANALYSIS') {
      try {
        if (!Number.isInteger(msg.tabId) || typeof msg.url !== 'string') throw new Error('Invalid scan target');
        const tab = await chrome.tabs.get(msg.tabId);
        if (tab.url !== msg.url) throw new Error('Tab changed; try again');
        await runAnalysis(msg.tabId, msg.url, { reason: 'on_demand' });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    }
    if (msg?.type === 'START_BATCH') {
      try {
        await startBatchProcessing(msg.urls);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    }
    if (msg?.type === 'PAUSE_BATCH') {
      try {
        await pauseBatchProcessing();
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    }
    if (msg?.type === 'RESUME_BATCH') {
      try {
        resumeBatchProcessing();
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    }
    if (msg?.type === 'STOP_BATCH') {
      try {
        await stopBatchProcessing();
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    }
    if (msg?.type === 'CAPTURE_SCREENSHOT') {
      try {
        if (!Number.isInteger(msg.tabId) || typeof msg.url !== 'string') throw new Error('Invalid capture target');
        const tab = await chrome.tabs.get(msg.tabId);
        if (tab.url !== msg.url) throw new Error('Tab changed; try again');
        const screenshot = await captureScreenshotWithOverlay(msg.tabId, msg.url);
        sendResponse({ ok: true, screenshot });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    }
    if (msg?.type === 'GET_BATCH_STATUS') {
      const data = await chrome.storage.local.get('batch::status');
      sendResponse(data['batch::status'] || null);
    }
    if (msg?.type === 'GET_BATCH_RESULTS') {
      const data = await chrome.storage.local.get('batch::queue');
      const queue = data['batch::queue'];
      if (queue) {
        const results = {
          total: queue.urls.length,
          completed: queue.urls.filter(u => u.status === 'completed').length,
          failed: queue.urls.filter(u => u.status === 'failed').length,
          pending: queue.urls.filter(u => u.status === 'pending').length,
          results: queue.urls
        };
        sendResponse(results);
      } else {
        sendResponse(null);
      }
    }
  })();
  return true;  // keep channel open for async
});

// Update the browser action badge text and color
async function setBadge({ text, color }) {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

// Badge shows a number (0-99) with color based on score
async function setBadgeForScore(score) {
  if (typeof score !== 'number' || isNaN(score)) 
    return setBadge({ text: '', color: '#6b7280' });
  const pct = Math.round(Math.min(99, Math.max(0, score)));
  const color = score >= 75 ? '#dc2626' : (score >= 40 ? '#eab308' : '#16a34a');
  return setBadge({ text: String(pct), color });
}

// Send progress updates to content script
function progress(tabId, percent, label) {
  chrome.tabs.sendMessage(tabId, { type: 'PROGRESS', percent, label }).catch(()=>{});
}

// Check if a host string is an IP address
function isIp(host) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || /^[0-9a-f:]+$/i.test(host);
}

// Generate candidate domains for RDAP (handles subdomains)
function rdapCandidates(host) {
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

// ============================================================================
// DUAL AI PIPELINE FUNCTIONS
// ============================================================================

/**
 * Pipeline A: Summarizer (AI Model A)
 * Extracts and summarizes page content with detected labels
 */
async function runPipelineA(config, contentText, tabId) {
  const startTime = Date.now();
  
  try {
    // Check if Model A is configured
    const hasModelA = checkModelAConfig(config);
    
    if (!hasModelA) {
      progress(tabId, 15, 'Content extracted (AI A disabled)');
      // Model A not configured, return text summary without AI
      return {
        summary: truncateForCost(contentText, 2000),
        labels: [],
        source: 'text_only',
        timing: Date.now() - startTime,
        timedOut: false
      };
    }
    
    progress(tabId, 15, 'AI A: Analyzing content…');
    
    // Call Model A (Summarizer)
    const summaryResult = await callModelA(config, contentText);
    
    progress(tabId, 40, 'AI A: Complete');
    
    return {
      summary: summaryResult.summary || truncateForCost(contentText, 2000),
      labels: summaryResult.labels || [],
      source: 'summarizer',
      timing: Date.now() - startTime,
      timedOut: false
    };
  } catch (err) {
    console.warn('Pipeline A failed, using text fallback:', err);
    return {
      summary: truncateForCost(contentText, 2000),
      labels: [],
      source: 'text_only',
      error: err.message,
      timing: Date.now() - startTime,
      timedOut: false
    };
  }
}

/**
 * Pipeline B: DNS + RDAP collector
 * Fetches DNS and RDAP data concurrently from multiple providers
 */
async function runPipelineB(hostname, tabId) {
  const startTime = Date.now();
  
  try {
    progress(tabId, 20, 'Pipeline B: Fetching DNS/RDAP…');
    
    // Fetch DNS and RDAP concurrently
    const [dnsResults, rdapResult] = await Promise.all([
      fetchAllDNSRecords(hostname),
      fetchRdapSmartCached(hostname)
    ]);
    
    progress(tabId, 50, 'Pipeline B: Complete');
    
    return {
      dns: dnsResults,
      rdap: rdapResult,
      timing: Date.now() - startTime,
      timedOut: false
    };
  } catch (err) {
    console.warn('Pipeline B partial failure:', err);
    return {
      dns: {},
      rdap: { ok: false, data: null, error: err.message },
      error: err.message,
      timing: Date.now() - startTime,
      timedOut: false
    };
  }
}

/**
 * Fetch all DNS records concurrently
 */
async function fetchAllDNSRecords(hostname) {
  const dnsResults = {};
  const promises = DNS_TYPES.map(async type => {
    try {
      const data = await fetchDnsResilientCached(hostname, type);
      return { type, result: normalizeDnsResult({ status: 'fulfilled', value: data }, type) };
    } catch (err) {
      return { type, result: normalizeDnsResult({ status: 'rejected', reason: err }, type) };
    }
  });
  
  const results = await Promise.all(promises);
  results.forEach(({ type, result }) => {
    dnsResults[type] = result;
  });
  
  return dnsResults;
}

/**
 * Build compact payload for Model B (Judge)
 */
function buildCompactPayload({ url, title, hostname, summaryResult, dnsRdapResult, timingMs }) {
  const now = new Date().toISOString();
  
  // Compact DNS records
  const compactDNS = {};
  for (const [type, data] of Object.entries(dnsRdapResult.dns)) {
    if (data.ok && data.records && data.records.length > 0) {
      compactDNS[type] = data.records.map(r => ({
        i: r.data || r.name,
        ttl: r.TTL || r.ttl || 0
      }));
    }
  }
  
  // Compact RDAP
  let compactRDAP = null;
  if (dnsRdapResult.rdap && dnsRdapResult.rdap.ok && dnsRdapResult.rdap.data) {
    const rdapData = dnsRdapResult.rdap.data;
    compactRDAP = {
      d: rdapData.ldhName || hostname,
      r: rdapData.entities?.[0]?.vcardArray?.[1]?.find(e => e[0] === 'fn')?.[3] || 'Unknown',
      s: rdapData.status || []
    };
  }
  
  // Build compact payload
  const payload = {
    t: now,
    u: url,
    T: title || '',
    x: summaryResult.summary,
    x_src: summaryResult.source,
    dns: compactDNS,
    rdap: compactRDAP,
    m: {
      lang: 'en',
      detectForm: summaryResult.labels.includes('form') || summaryResult.labels.includes('login_form'),
      detectLogin: summaryResult.labels.includes('login_form') || summaryResult.labels.includes('credential_request'),
      partial: !summaryResult.summary || summaryResult.summary.length === 0,
      timedOut: [],
      timing: timingMs
    }
  };
  
  return payload;
}

/**
 * Check if Model A is configured
 */
function checkModelAConfig(config) {
  const provider = config.modelA_provider || 'none';
  
  if (provider === 'gemini') {
    return !!(config.modelA_apiKey && config.modelA_apiKey.trim());
  } else if (provider === 'cerebras') {
    return !!(config.modelA_cerebrasApiKey && config.modelA_cerebrasApiKey.trim());
  } else if (provider === 'custom') {
    return !!(config.modelA_customApiKey && config.modelA_customApiKey.trim() && 
              config.modelA_customEndpoint && config.modelA_customEndpoint.trim() &&
              config.modelA_customModel && config.modelA_customModel.trim());
  }
  
  return false;
}

/**
 * Call Model A (Summarizer)
 */
async function callModelA(config, contentText) {
  const provider = config.modelA_provider || 'gemini';
  const trimmedText = truncateForCost(contentText, config.modelA_maxTokens || 5000);
  
  const systemPrompt = `You are a precise web content analyzer for phishing detection. Analyze page text and return JSON with:
1. "summary": Ultra-concise 1-sentence page purpose focusing on actions requested from user
2. "labels": Array of detected threats/intents

CRITICAL LABELS (use exact strings):
- "login_form" - Login/signin page
- "credential_request" - Asks for password/username
- "payment_form" - Payment/credit card input
- "account_verification" - Verify account/email
- "password_reset" - Reset/change password
- "urgent_action" - Urgent language (act now, limited time)
- "prize_claim" - Win/claim prize/lottery
- "tax_refund" - Tax/government refund
- "security_alert" - Security warning/breach notification
- "suspended_account" - Account suspended/locked
- "update_required" - Must update info/payment
- "cryptocurrency" - Crypto investment/wallet
- "tech_support" - Tech support/call number
- "survey_reward" - Survey for gift card/prize
- "download_prompt" - Download file/software
- "bank_verification" - Bank account verification
- "shipping_issue" - Package delivery problem

Be AGGRESSIVE in labeling - mark ANY suspicious element. Multiple labels are expected.
Output ONLY valid JSON, no markdown:
{"summary":"...","labels":["...","..."]}`;

  const userPrompt = `Page content:\n${trimmedText}`;
  
  if (provider === 'gemini') {
    return await callGeminiSummarizer(
      config.modelA_apiKey,
      config.modelA_model || MODEL_A_DEFAULT,
      systemPrompt,
      userPrompt
    );
  } else if (provider === 'cerebras') {
    return await callCerebrasSummarizer(
      config.modelA_cerebrasApiKey,
      config.modelA_cerebrasModel || 'llama-3.3-70b',
      systemPrompt,
      userPrompt
    );
  } else if (provider === 'custom') {
    return await callCustomSummarizer(
      {
        endpoint: config.modelA_customEndpoint,
        apiKey: config.modelA_customApiKey,
        model: config.modelA_customModel,
        maxTokens: config.modelA_maxTokens || 1000
      },
      systemPrompt,
      userPrompt
    );
  }
  
  throw new Error('Invalid Model A provider');
}

/**
 * Prime Model B with expected payload format
 * This reduces latency by preparing the model in advance
 */
async function primeModelB(config) {
  // Send a lightweight priming message to warm up the model
  const primingMessage = `Ready to receive compact payload with format: {t, u, T, x, x_src, dns, rdap, m}`;
  
  // We don't need to wait for this - it's a fire-and-forget operation
  // The goal is to reduce cold-start latency for the actual verdict call
  return Promise.resolve(); // Placeholder for now - can be enhanced with actual API warming
}

/**
 * Call Model B (Judge/Verdict)
 */
async function callModelB(config, compactPayload) {
  const provider = config.modelB_provider || config.aiProvider || 'gemini';
  
  // Use legacy config as fallback
  const apiKey = config.modelB_apiKey || config.apiKey;
  const model = config.modelB_model || config.modelName || MODEL_B_DEFAULT;
  const cerebrasApiKey = config.modelB_cerebrasApiKey || config.cerebrasApiKey;
  const cerebrasModel = config.modelB_cerebrasModel || config.cerebrasModel || 'llama-3.3-70b';
  const customEndpoint = config.modelB_customEndpoint || config.customEndpoint;
  const customApiKey = config.modelB_customApiKey || config.customApiKey;
  const customModel = config.modelB_customModel || config.customModel;
  const temperature = config.modelB_temperature || config.customTemperature || 0.2;
  const maxTokens = config.modelB_maxTokens || config.customMaxTokens || 2048;
  const globalSystemPrompt = config.globalSystemPrompt || '';
  const customSystemPrompt = config.customSystemPrompt || '';
  
  const effectiveSystemPrompt = globalSystemPrompt || customSystemPrompt || '';
  
  if (provider === 'gemini') {
    return await callGemini(apiKey, model, compactPayload, effectiveSystemPrompt);
  } else if (provider === 'cerebras') {
    return await callCerebras(cerebrasApiKey, cerebrasModel, compactPayload, effectiveSystemPrompt);
  } else if (provider === 'custom') {
    return await callCustomLLM({
      endpoint: customEndpoint,
      apiKey: customApiKey,
      model: customModel,
      stream: false,
      temperature,
      topP: 1,
      maxTokens,
      systemPrompt: effectiveSystemPrompt,
      extraParams: config.customExtraParams || ''
    }, compactPayload);
  }
  
  throw new Error('Invalid Model B provider');
}

// ============================================================================
// MODEL A (SUMMARIZER) API CALLS
// ============================================================================

async function callGeminiSummarizer(apiKey, model, systemPrompt, userPrompt) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  
  const body = {
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
    generationConfig: { 
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          summary: { type: "STRING" },
          labels: { type: "ARRAY", items: { type: "STRING" } }
        },
        required: ["summary", "labels"]
      }
    }
  };
  
  const res = await fetchWithTimeout(endpoint, { 
    method: "POST", 
    headers: { "content-type": "application/json" }, 
    body: JSON.stringify(body) 
  }, 15000);
  
  if (!res.ok) {
    throw new Error(`Gemini summarizer error: ${res.status}`);
  }
  
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  
  try {
    return JSON.parse(text);
  } catch (e) {
    return { summary: text || '', labels: [] };
  }
}

async function callCerebrasSummarizer(apiKey, model, systemPrompt, userPrompt) {
  const endpoint = 'https://api.cerebras.ai/v1/chat/completions';
  
  const body = {
    model: model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.2,
    max_tokens: 1000,
    stream: false
  };
  
  const res = await fetchWithTimeout(endpoint, { 
    method: "POST", 
    headers: { 
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`
    }, 
    body: JSON.stringify(body) 
  }, 15000);
  
  if (!res.ok) {
    throw new Error(`Cerebras summarizer error: ${res.status}`);
  }
  
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  
  try {
    return JSON.parse(content);
  } catch (e) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return { summary: content || '', labels: [] };
  }
}

async function callCustomSummarizer(config, systemPrompt, userPrompt) {
  const body = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: 0.2,
    max_tokens: config.maxTokens || 1000,
    stream: false
  };
  
  const res = await fetchWithTimeout(config.endpoint, { 
    method: "POST", 
    headers: { 
      "content-type": "application/json",
      "authorization": `Bearer ${config.apiKey}`
    }, 
    body: JSON.stringify(body) 
  }, 15000);
  
  if (!res.ok) {
    throw new Error(`Custom summarizer error: ${res.status}`);
  }
  
  const data = await res.json();
  
  // Try multiple possible response formats
  let content = null;
  if (data?.choices?.[0]?.message?.content) {
    content = data.choices[0].message.content;
  } else if (data?.choices?.[0]?.text) {
    content = data.choices[0].text;
  } else if (data?.content) {
    content = data.content;
  } else if (data?.response) {
    content = data.response;
  } else if (data?.content?.[0]?.text) {
    content = data.content[0].text;
  }
  
  if (!content) {
    return { summary: '', labels: [] };
  }
  
  try {
    return JSON.parse(content);
  } catch (e) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e2) {
        return { summary: content || '', labels: [] };
      }
    }
    return { summary: content || '', labels: [] };
  }
}


// ============================================================================
// END DUAL AI PIPELINE FUNCTIONS
// ============================================================================

// Main analysis flow with dual AI pipeline
async function runAnalysis(tabId, url, { reason } = {}) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only HTTP(S) pages can be analyzed');
  const config = await chrome.storage.local.get({ 
    // Model A (Summarizer) configuration
    modelA_provider: 'gemini',
    modelA_apiKey: null,
    modelA_model: MODEL_A_DEFAULT,
    modelA_maxTokens: 1000,
    modelA_timeout: 10000,
    modelA_cerebrasApiKey: null,
    modelA_cerebrasModel: 'llama-3.3-70b',
    modelA_customEndpoint: null,
    modelA_customApiKey: null,
    modelA_customModel: null,
    
    // Model B (Judge/Verdict) configuration
    modelB_provider: 'gemini',
    modelB_apiKey: null,
    modelB_model: MODEL_B_DEFAULT,
    modelB_temperature: 0.2,
    modelB_maxTokens: 2048,
    modelB_cerebrasApiKey: null,
    modelB_cerebrasModel: 'llama-3.3-70b',
    modelB_customEndpoint: null,
    modelB_customApiKey: null,
    modelB_customModel: null,
    
    // Legacy fallback support
    apiKey: null, 
    modelName: MODEL_DEFAULT,
    aiProvider: 'gemini',
    cerebrasApiKey: null,
    cerebrasModel: 'llama-3.3-70b',
    customEndpoint: null,
    customApiKey: null,
    customModel: null,
    customStream: 'false',
    customTemperature: 0.2,
    customTopP: 1,
    customMaxTokens: 2048,
    customSystemPrompt: '',
    customExtraParams: '',
    globalSystemPrompt: '',
    
    whitelist: [],
    blacklist: []
  });
  
  // Use Model B config with fallback to legacy config
  const modelB_provider = config.modelB_provider || config.aiProvider || 'gemini';
  const modelB_apiKey = config.modelB_apiKey || config.apiKey;
  const modelB_cerebrasApiKey = config.modelB_cerebrasApiKey || config.cerebrasApiKey;
  const modelB_customApiKey = config.modelB_customApiKey || config.customApiKey;
  const modelB_customEndpoint = config.modelB_customEndpoint || config.customEndpoint;
  const modelB_customModel = config.modelB_customModel || config.customModel;
  
  // Check if we have at least Model B configured (required for verdict)
  let hasModelB = false;
  if (modelB_provider === 'cerebras') {
    hasModelB = !!(modelB_cerebrasApiKey && modelB_cerebrasApiKey.trim());
  } else if (modelB_provider === 'custom') {
    hasModelB = !!(modelB_customApiKey && modelB_customApiKey.trim() && modelB_customEndpoint && modelB_customEndpoint.trim() && modelB_customModel && modelB_customModel.trim());
  } else {
    hasModelB = !!(modelB_apiKey && modelB_apiKey.trim());
  }
  
  if (!hasModelB) {
    await setBadge({ text: 'KEY', color: '#6b7280' });
    progress(tabId, 100, 'API key missing');
    return;
  }
  
  let hostname, pageTitle;
  try { 
    hostname = new URL(url).hostname;
    pageTitle = '';
  } catch { 
    hostname = ''; 
    pageTitle = '';
  }
  
  // Check whitelist/blacklist
  if (config.whitelist.includes(hostname)) {
    await setBadgeForScore(0);
    const key = storageKey(url);
    await chrome.storage.local.set({ 
      [key]: { 
        when: Date.now(), 
        url, 
        ai: {
          verdict: '✓ Whitelisted',
          scamometer: 0,
          reason: 'This domain is in your whitelist and is trusted.',
          positives: ['User whitelisted domain'],
          negatives: []
        },
        raw: { fullUrl: url },
        whitelisted: true
      } 
    });
    progress(tabId, 100, 'Whitelisted');
    return;
  }
  
  if (config.blacklist.includes(hostname)) {
    await setBadgeForScore(100);
    const key = storageKey(url);
    await chrome.storage.local.set({ 
      [key]: { 
        when: Date.now(), 
        url, 
        ai: {
          verdict: '⚠️ Blacklisted',
          scamometer: 100,
          reason: 'This domain is in your blacklist and should be avoided.',
          positives: [],
          negatives: ['User blacklisted domain']
        },
        raw: { fullUrl: url },
        blacklisted: true
      } 
    });
    await chrome.tabs.sendMessage(tabId, { type: 'OVERLAY', score: 100 }).catch(()=>{});
    progress(tabId, 100, 'Blacklisted');
    return;
  }

  // Show hourglass on badge during analysis
  await setBadge({ text: '⌛', color: '#06b6d4' });
  
  // START DNS/RDAP LOOKUPS IMMEDIATELY (don't wait for page scraping)
  progress(tabId, 3, 'Starting DNS/RDAP lookups…');
  const pipelineBPromise = runPipelineB(hostname, tabId);
  
  // While DNS/RDAP runs, extract page content
  progress(tabId, 5, 'Extracting page content…');
  const scraped = await chrome.tabs.sendMessage(tabId, { type: 'SCRAPE_REQUEST' }).catch(() => null);
  const contentText = scraped?.text || '';
  pageTitle = scraped?.title || '';

  // Start summarizer pipeline now that we have content
  const timingStart = Date.now();
  progress(tabId, 10, 'Analyzing content…');
  const pipelineAPromise = runPipelineA(config, contentText, tabId);
  
  // Wait for both pipelines to complete (they run concurrently)
  const [pipelineAResult, pipelineBResult] = await Promise.all([
    pipelineAPromise,
    pipelineBPromise
  ]);
  
  const timingEnd = Date.now();
  const totalWaitMs = timingEnd - timingStart;
  
  progress(tabId, 65, 'Pipelines complete, assembling payload…');
  
  // Build compact payload for Model B (Judge)
  const compactPayload = buildCompactPayload({
    url,
    title: pageTitle,
    hostname,
    summaryResult: pipelineAResult,
    dnsRdapResult: pipelineBResult,
    timingMs: {
      summarizerMs: pipelineAResult.timing,
      recordMs: pipelineBResult.timing,
      waitedMs: totalWaitMs
    }
  });
  
  progress(tabId, 75, 'Requesting AI verdict…');
  
  // Call Model B (Judge/Verdict) with compact payload
  let verdict;
  try {
    verdict = await callModelB(config, compactPayload);
  } catch (err) {
    console.error('Model B failed:', err);
    verdict = {
      verdict: 'Error',
      scamometer: null,
      reason: `Analysis failed: ${err.message}`,
      positives: [],
      negatives: ['Analysis error'],
      threatCategory: null,
      description: 'Unable to complete analysis'
    };
  }

  // Store analysis in chrome.storage.local
  const key = storageKey(url);
  const analysisResult = { 
    when: Date.now(), 
    url, 
    ai: verdict,
    summary: pipelineAResult,
    dnsResults: pipelineBResult.dns,
    rdap: pipelineBResult.rdap,
    compactPayload,
    timing: {
      summarizerMs: pipelineAResult.timing,
      recordMs: pipelineBResult.timing,
      totalMs: totalWaitMs
    }
  };
  await chrome.storage.local.set({ [key]: analysisResult });

  // Update badge with final score
  if (verdict.scamometer === null) await setBadge({ text: 'ERR', color: '#6b7280' });
  else await setBadgeForScore(verdict.scamometer);

  progress(tabId, 95, 'Applying overlay…');
  if (verdict.scamometer !== null) await chrome.tabs.sendMessage(tabId, { type: 'OVERLAY', score: verdict.scamometer }).catch(()=>{});
  progress(tabId, 100, 'Done');

  // Notify popup (if open)
  try {
    chrome.runtime.sendMessage({ type: 'analysis_complete', tabId, score: verdict.scamometer });
  } catch {}
  
  // Send webhook notification for single URL analysis (if not part of batch)
  if (reason !== 'batch') {
    try {
      const { webhookEnabled = false } = await chrome.storage.local.get({ webhookEnabled: false });
      if (webhookEnabled) {
        await sendWebhookNotification({
          total: 1,
          completed: 1,
          failed: 0,
          pending: 0,
          results: [{
            url: url,
            status: 'completed',
            result: analysisResult,
            screenshot: null
          }]
        });
      }
    } catch (e) {
      console.error('Webhook notification failed for single URL:', e);
    }
  }
}

// Helper: fetch with timeout
async function fetchWithTimeout(url, options = {}, timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try { 
    return await fetch(url, { ...options, signal: controller.signal });
  } finally { 
    clearTimeout(id);
  }
}

// DNS query using Google and Cloudflare, with caching
async function fetchDnsResilientCached(domain, type) {
  const cacheKey = `${domain}:${type}`;
  const now = Date.now();
  if (dnsCache[cacheKey] && (now - dnsCache[cacheKey].when) < DNS_CACHE_TTL) {
    return dnsCache[cacheKey].value;
  }
  let result = null;
  try {
    const g = await fetchWithTimeout(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${type}`);
    if (g.ok) result = await g.json();
    else throw new Error(`DNS google status ${g.status}`);
  } catch {
    const cf = await fetchWithTimeout(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${type}`, {
      headers: { 'accept': 'application/dns-json' }
    });
    if (cf.ok) result = await cf.json();
    else throw new Error(`DNS cloudflare status ${cf.status}`);
  }
  dnsCache[cacheKey] = { value: result, when: now };
  return result;
}

// RDAP query (IP or domain) with caching
async function fetchRdapSmartCached(host) {
  const now = Date.now();
  if (rdapCache[host] && (now - rdapCache[host].when) < RDAP_CACHE_TTL) {
    return rdapCache[host].result;
  }
  let result = null;
  try {
    if (isIp(host)) {
      const r = await fetchWithTimeout(`https://rdap.org/ip/${encodeURIComponent(host)}`);
      if (!r.ok) throw new Error(`RDAP IP status ${r.status}`);
      const j = await r.json();
      result = { ok: true, data: j, target: host, endpoint: 'ip' };
    } else {
      const cands = rdapCandidates(host);
      let lastErr = null;
      for (const cand of cands) {
        try {
          const r = await fetchWithTimeout(`https://rdap.org/domain/${encodeURIComponent(cand)}`);
          if (!r.ok) { lastErr = new Error(`RDAP status ${r.status} for ${cand}`); continue; }
          const j = await r.json();
          if (j && (j.ldhName || j.handle || Array.isArray(j.events))) {
            result = { ok: true, data: j, target: cand, endpoint: 'domain' };
            break;
          }
          lastErr = new Error(`RDAP malformed for ${cand}`);
        } catch (e) {
          lastErr = e;
        }
      }
      if (!result) throw lastErr || new Error('RDAP fetch failed');
    }
  } catch (e) {
    result = { ok: false, data: null, error: e.message, target: host };
  }
  rdapCache[host] = { result, when: now };
  return result;
}

// Normalize DNS/RDAP outputs for reporting
function normalizeDnsResult(settled, type) {
  if (settled.status === 'rejected') {
    return { ok: false, records: [], error: settled.reason?.message || 'fetch failed', type };
  }
  const data = settled.value;
  if (!data || data.Status !== 0) {
    return { ok: false, records: [], error: `DNS Status: ${data?.Status}`, type };
  }
  const records = data.Answer || data.Authority || [];
  return { ok: true, records, error: null, type };
}
function normalizeRdapResult(settled) {
  if (settled.status === 'rejected') {
    return { ok: false, data: null, error: settled.reason?.message || 'fetch failed' };
  }
  return { ok: true, data: settled.value, error: null };
}

// Trim text to control payload size
function truncateForCost(str, maxLen) {
  if (!str) return "";
  return str.length <= maxLen ? str : (str.slice(0, maxLen) + "\\n[…truncated…]");
}

// Optimized Gemini API call with schema validation - Zero false positives, accurate detection
const AI_SYSTEM_INSTRUCTION = `You are an elite cybersecurity AI specialized in phishing and scam detection. Your mission is to protect users while maintaining precision to avoid false alarms. Current date/time: ${new Date().toISOString()}

═══════════════════════════════════════════════════════════════════════════════
🎯 CORE ANALYSIS FRAMEWORK
═══════════════════════════════════════════════════════════════════════════════

DECISION HIERARCHY (apply in order):
1. ✅ LEGITIMACY FIRST: Identify and protect legitimate sites with high confidence
2. 🔍 THREAT DETECTION: Detect malicious patterns with evidence-based scoring  
3. ⚖️ BALANCED JUDGMENT: When uncertain, err on the side of safety (lower scores)

═══════════════════════════════════════════════════════════════════════════════
✅ LEGITIMACY INDICATORS (Strong Signals for LOW Scores 0-25)
═══════════════════════════════════════════════════════════════════════════════

TIER 1 - ALWAYS LEGITIMATE (Score: 0-15):
• Established tech platforms: google.com, microsoft.com, apple.com, amazon.com, facebook.com, twitter.com/x.com, linkedin.com, github.com, gitlab.com
• Financial institutions on official domains: paypal.com, stripe.com, square.com, chase.com, bankofamerica.com
• Government/Educational: .gov, .mil, .edu, .ac.*, official state domains
• Major CDNs/Infrastructure: cloudflare.com, akamai.com, fastly.com
• Aged established brands: 5+ years with professional RDAP records

TIER 2 - USER-GENERATED CONTENT PLATFORMS (Score: 5-20):
• Social profiles: twitter.com/[username], facebook.com/[page], instagram.com/[user], linkedin.com/in/[user]
• Development platforms: github.io/[user]/[project], github.com/[org]/[repo], gitlab.io/[user]
• File sharing: dropbox.com/s/, drive.google.com/file/, onedrive.com/share
• Blogging platforms: medium.com/@[user], substack.com/[name], wordpress.com/[blog]
• Website builders: [name].wixsite.com, [name].squarespace.com, [name].webflow.io
• Documentation: readthedocs.io, gitbook.io
⚠️ EXCEPTION: Impersonation attempts on these platforms require careful evaluation

TIER 3 - LEGITIMATE NEW/SMALL BUSINESSES (Score: 15-30):
• New domain (30-365 days) BUT with:
  - Professional website design and complete content
  - Valid business RDAP info (company name, proper registrant)
  - Proper SSL certificate from recognized CA
  - Matching social media presence or verifiable business info
  - No suspicious urgency or credential requests
• Startups, small e-commerce, local businesses with professional presence

═══════════════════════════════════════════════════════════════════════════════
🚨 THREAT DETECTION MATRIX (Evidence-Based Scoring)
═══════════════════════════════════════════════════════════════════════════════

CRITICAL THREAT SIGNALS (Immediate High Risk 70-95):
🔴 ACTIVE CREDENTIAL HARVESTING:
   • Login/password form + domain age <30 days + brand impersonation = 85-95
   • Credential request + privacy-protected RDAP + urgency language = 80-92
   • Payment form + suspicious TLD (.tk, .ml, .ga, etc.) + new domain = 82-94

🔴 TYPOSQUATTING & BRAND IMPERSONATION:
   • Domain similar to major brand (paypa1, g00gle, micros0ft) + forms = 88-96
   • Official brand name in content BUT mismatched domain + credential request = 82-93
   • Subdomain impersonation (secure-login.paypal-verify.com vs paypal.com) = 85-94

🔴 SOCIAL ENGINEERING SCAMS:
   • "Account suspended/locked" + "verify now" + forms + new domain = 80-92
   • Prize/lottery/refund claims + payment/personal info request = 78-90
   • Fake tech support + urgency + payment = 75-88
   • Government impersonation (IRS, FBI, police) on non-gov domain = 85-95

🔴 INFRASTRUCTURE RED FLAGS:
   • Domain <7 days old + ANY credential/payment form = 80-92
   • IP-based hosting + forms + no proper DNS records = 75-88
   • Privacy-protected RDAP + new domain + impersonation claims = 78-90

MODERATE THREAT SIGNALS (Medium Risk 40-69):
🟡 SUSPICIOUS PATTERNS:
   • New domain (30-90 days) + credential form but no urgency/impersonation = 45-60
   • Generic template site + privacy RDAP + forms = 48-62
   • Aggressive marketing + payment requests + suspicious TLD = 50-65
   • Missing security indicators (poor SSL, no contact info) + forms = 42-58

LOW-MODERATE CONCERNS (Score 25-40):
🟢 MINOR FLAGS:
   • Very new domain (<30 days) but legitimate business indicators = 25-35
   • User-content platform with professional presentation but some claims = 28-38
   • New e-commerce with limited info but no active threats = 30-40

═══════════════════════════════════════════════════════════════════════════════
🧮 ENHANCED SCORING LOGIC
═══════════════════════════════════════════════════════════════════════════════

LEGITIMACY SCORING (Start at baseline, adjust):
• Tier 1 legitimate domain: Start at 8, adjust for forms/context (max 15)
• Tier 2 user platform: Start at 12, adjust for impersonation claims
• Tier 3 new business: Start at 20, adjust for red flags
• Unknown domain: Start at 35, evaluate threat signals

THREAT AMPLIFICATION (Multiplicative for multiple signals):
• Single high-risk signal: Base threat score
• Two high-risk signals: Base + 50% amplification
• Three+ high-risk signals: Base + 100% amplification (cap at 96)

DOMAIN AGE CONTEXT (from RDAP, current: ${new Date().toISOString()}):
• <7 days + credential form = CRITICAL (start at 80)
• 7-30 days + forms = HIGH RISK (start at 70, adjust)
• 30-90 days + forms = MEDIUM RISK (start at 50, adjust for legitimacy)
• 90-365 days + professional = LOW-MEDIUM (30-45, adjust)
• 1-3 years + professional = LOW (15-30)
• 3+ years + clean history = VERY LOW (5-20)

MODEL A LABELS (x_src: "summarizer") - CRITICAL WEIGHT:
High-Risk Labels (each adds significant weight):
• "credential_request" = +35 points (more if combined with urgency)
• "urgent_action" = +30 points (especially with forms)
• "login_form" = +25 points (on new/suspicious domains)
• "payment_form" = +28 points (especially if privacy-protected)
• "suspended_account" = +40 points (classic phishing tactic)
• "security_alert" = +35 points (when fake)
• "prize_claim" = +42 points (common scam)
• "verify_identity" = +38 points (phishing red flag)

⚠️ LABEL COMBINATIONS (exponential risk):
• credential_request + urgent_action + new_domain = 85+
• suspended_account + security_alert + login_form = 88+
• prize_claim + payment_form = 82+

═══════════════════════════════════════════════════════════════════════════════
🎨 SPECIAL CASES & NUANCED SCENARIOS
═══════════════════════════════════════════════════════════════════════════════

URL PATH ANALYSIS (FULL URL context):
✓ twitter.com/username = Profile (Low: 8)
✓ github.io/org/project = Project page (Low: 10-15)
✓ dropbox.com/s/xyz = Shared file (Low: 12-18)
✓ medium.com/@author/post = Blog post (Low: 10-15)
⚠️ github.io/random claiming "Microsoft Support" + forms = High (82-88)
⚠️ User platform claiming government/financial authority + credentials = High (85-92)

LEGITIMATE NEW SITES (avoid false positives):
✓ Professional startup with:
  - Complete website (About, Contact, Terms, Privacy)
  - Valid business RDAP (company name, proper registrant data)
  - Social media presence or external validation
  - No urgency/pressure tactics
  - No unexpected credential requests
  = Score: 18-30 (Low risk despite being new)

IMPERSONATION ON LEGIT PLATFORMS:
• github.io page titled "Apple Official Support Portal" requesting credentials
  - Platform is legitimate BUT claim is suspicious
  - Check: Does Apple actually use this specific page? (unlikely)
  - Score: 75-85 (High risk due to impersonation despite legitimate host)

═══════════════════════════════════════════════════════════════════════════════
📊 OUTPUT REQUIREMENTS
═══════════════════════════════════════════════════════════════════════════════

REQUIRED JSON FORMAT (no markdown):
{
  "verdict": "Low risk|Medium risk|High risk",
  "scamometer": 0-100,
  "reason": "Clear explanation including age calculation from ${new Date().toISOString()}",
  "description": "Concise 1-2 sentence summary",
  "threatCategory": "phishing|brand_impersonation|typosquatting|scareware|financial_fraud|malware_distribution|fake_shop|tech_support_scam|survey_scam|credential_harvesting|social_engineering|suspicious_redirect|data_harvesting|other|null",
  "positives": ["List of legitimate indicators found"],
  "negatives": ["List suspicious/malicious indicators found, and remember: Do NOT emit filler placeholders anywhere (examples: "None detected", "No threat detected", "N/A", "✗", "✓", "-", "nothing", "no issues"). These tokens must never appear as array elements or values."]
}

VERDICT THRESHOLDS:
• "Low risk" = 0-30 (generally safe)
• "Medium risk" = 31-69 (use caution, investigate)  
• "High risk" = 70-100 (likely threat, avoid)

═══════════════════════════════════════════════════════════════════════════════
🎓 CALIBRATION EXAMPLES (Reference for Consistency)
═══════════════════════════════════════════════════════════════════════════════

LEGITIMATE SITES (Low: 0-25):
1. google.com = 8 (Tier 1, established)
2. twitter.com/elonmusk = 5 (Social profile)
3. github.com/microsoft/vscode = 9 (Official repo)
4. github.io/pytorch/tutorials = 12 (Official docs)
5. paypal.com (with login) = 10 (Legitimate, expected)
6. newstartup.com (45 days, professional) = 22 (New but legitimate)
7. dropbox.com/s/abc123 = 14 (File share)
8. medium.com/@author/article = 11 (Blog post)
9. myshop.com (2 years, e-commerce) = 16 (Established shop)
10. example-university.edu = 8 (Educational)

MEDIUM RISK (26-69):
11. verify-account.com (15 days, generic content) = 48 (New + suspicious name)
12. prize-winner.net (40 days, sweepstakes) = 52 (New + prize claims)
13. tech-help-desk.com (60 days, support claims) = 45 (New + support claim)
14. crypto-trading.net (20 days, investment) = 55 (New + financial)

HIGH RISK (70-96):
15. paypa1-secure.com (5 days) + login form = 92 (Typosquatting + new + credentials)
16. github.io/random-user claiming "Official Apple Support" + credential form = 88 (Impersonation)
17. secure-account-verify.com (3 days) + "urgent" + suspended account message + forms = 94 (Multiple critical flags)
18. irs-refund-portal.com (8 days) + payment form = 93 (Gov impersonation + new)
19. dropbox.com/s/xyz hosting "IRS Tax Refund Portal" + payment = 90 (Gov impersonation on user platform)
20. amaz0n-prize.com (12 days) + "you won" + payment = 89 (Typosquatting + scam + new)
21. micros0ft-support.net (6 days) + tech support + payment = 91 (Brand impersonation)
22. account-suspended-verify.com (2 days) + login + urgency = 95 (Phishing kit signature)

═══════════════════════════════════════════════════════════════════════════════
📥 INPUT DATA STRUCTURE
═══════════════════════════════════════════════════════════════════════════════

Compact payload from dual pipelines:
- t: ISO timestamp
- u: FULL URL (including path - analyze completely!)
- T: Page title
- x: Content summary from Model A (or raw text if Model A disabled)
- x_src: "summarizer" (AI labels present) or "text_only" (fallback)
- dns: DNS records {A:[{i,ttl}], AAAA, MX, NS, TXT, CNAME, SOA, etc.}
- rdap: Domain registration {d: domain, r: registrant, s: status}
- m: Metadata {detectForm: bool, detectLogin: bool, timing: ms}

═══════════════════════════════════════════════════════════════════════════════

ANALYSIS APPROACH:
1. Parse input data completely
2. Identify legitimacy tier (1/2/3 or unknown)
3. Check for threat signals (credentials, impersonation, urgency, age)
4. Apply scoring logic with context
5. Validate against calibration examples
6. Generate structured JSON response

Remember: Accuracy requires BOTH protecting legitimate users AND catching real threats. Balance is key.`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING" },
    scamometer: { type: "NUMBER" },
    reason: { type: "STRING" },
    positives: { type: "ARRAY", items: { type: "STRING" } },
    negatives: { type: "ARRAY", items: { type: "STRING" } },
    threatCategory: { type: "STRING", nullable: true },
    description: { type: "STRING" }
  },
  required: ["verdict","scamometer","reason","positives","negatives","threatCategory","description"]
};
async function callGemini(apiKey, model, analysis, customSystemPrompt = '') {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  
  // Use custom system prompt if provided, otherwise use default
  const systemPrompt = customSystemPrompt || AI_SYSTEM_INSTRUCTION;
  
  const body = {
    contents: [{ role: "user", parts: [{ text: `Analyze this report: ${JSON.stringify(analysis)}` }] }],
    systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
    generationConfig: { responseMimeType: "application/json", responseSchema: RESPONSE_SCHEMA }
  };
  const res = await fetchWithTimeout(endpoint, { 
    method: "POST", headers: { "content-type": "application/json" }, 
    body: JSON.stringify(body) 
  }, 20000);
  
  // Check for API key errors
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      // API key error - pause batch if active
      if (batchProcessingActive) {
        await pauseBatchProcessing();
        // Notify popup to show API key dialog
        try {
          chrome.runtime.sendMessage({ type: 'API_KEY_ERROR', status: res.status });
        } catch {}
      }
      throw new Error(`Gemini API authentication error: ${res.status}`);
    }
    throw new Error(`Gemini API error: ${res.status} ${t}`);
  }
  
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  try {
    return JSON.parse(text);
  } catch (e) {
    const m = text && text.match(/\\{[\\s\\S]*\\}$/);
    if (m) return JSON.parse(m[0]);
    throw new Error('Invalid JSON from Gemini');
  }
}

/**
 * Call Cerebras AI API for phishing/scam detection
 * Cerebras uses OpenAI-compatible chat completion format
 */
async function callCerebras(apiKey, model, analysis, customSystemPrompt = '') {
  const endpoint = 'https://api.cerebras.ai/v1/chat/completions';
  
  // Use custom system prompt if provided, otherwise use default
  const systemPrompt = customSystemPrompt || AI_SYSTEM_INSTRUCTION;
  
  // Construct the prompt for Cerebras
  const userPrompt = `Analyze this website for phishing and scam indicators: ${JSON.stringify(analysis)}`;
  
  const body = {
    model: model,
    messages: [
      { 
        role: "system", 
        content: systemPrompt 
      },
      {
        role: "user",
        content: userPrompt
      }
    ],
    temperature: model === 'llama-3.3-70b' ? 0.2 : 0.6,
    max_tokens: model === 'llama-3.3-70b' ? 2048 : 16382,
    top_p: model === 'llama-3.3-70b' ? 1 : 0.95,
    stream: false
  };
  
  const res = await fetchWithTimeout(endpoint, { 
    method: "POST", 
    headers: { 
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`
    }, 
    body: JSON.stringify(body) 
  }, 30000); // 30 second timeout for Cerebras
  
  // Check for API key errors
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      // API key error - pause batch if active
      if (batchProcessingActive) {
        await pauseBatchProcessing();
        // Notify popup to show API key dialog
        try {
          chrome.runtime.sendMessage({ type: 'API_KEY_ERROR', status: res.status });
        } catch {}
      }
      throw new Error(`Cerebras API authentication error: ${res.status}`);
    }
    throw new Error(`Cerebras API error: ${res.status} ${t}`);
  }
  
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  
  if (!content) {
    throw new Error('No response from Cerebras API');
  }
  
  // Parse JSON from the response
  try {
    // Try to parse the entire content as JSON
    return JSON.parse(content);
  } catch (e) {
    // If that fails, try to extract JSON from markdown code blocks
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || 
                      content.match(/```\s*([\s\S]*?)\s*```/) ||
                      content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      try {
        return JSON.parse(jsonStr);
      } catch (e2) {
        throw new Error('Invalid JSON in Cerebras response');
      }
    }
    
    throw new Error('Could not extract JSON from Cerebras response');
  }
}

/**
 * Call custom LLM API for phishing/scam detection
 * Supports any OpenAI-compatible endpoint with full parameter customization
 */
async function callCustomLLM(config, analysis) {
  const { 
    endpoint, 
    apiKey, 
    model, 
    stream = false, 
    temperature = 0.2, 
    topP = 1, 
    maxTokens = 2048,
    systemPrompt = '',
    extraParams = ''
  } = config;
  
  // Use custom system prompt if provided, otherwise use default
  const systemContent = systemPrompt || AI_SYSTEM_INSTRUCTION;
  
  // Construct the user prompt
  const userPrompt = `Analyze this website for phishing and scam indicators: ${JSON.stringify(analysis)}`;
  
  // Build the request body
  const body = {
    model: model,
    messages: [
      { 
        role: "system", 
        content: systemContent 
      },
      {
        role: "user",
        content: userPrompt
      }
    ],
    temperature: temperature,
    max_tokens: maxTokens,
    top_p: topP,
    stream: stream
  };
  
  // Parse and merge extra parameters if provided
  if (extraParams) {
    try {
      const extra = JSON.parse(extraParams);
      Object.assign(body, extra);
    } catch (e) {
      console.warn('Failed to parse extra parameters:', e);
    }
  }
  
  const res = await fetchWithTimeout(endpoint, { 
    method: "POST", 
    headers: { 
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`
    }, 
    body: JSON.stringify(body) 
  }, 60000); // 60 second timeout for custom LLM
  
  // Check for API key errors
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (res.status === 401 || res.status === 403) {
      // API key error - pause batch if active
      if (batchProcessingActive) {
        await pauseBatchProcessing();
        // Notify popup to show API key dialog
        try {
          chrome.runtime.sendMessage({ type: 'API_KEY_ERROR', status: res.status });
        } catch {}
      }
      throw new Error(`Custom LLM API authentication error: ${res.status}`);
    }
    throw new Error(`Custom LLM API error: ${res.status} ${t}`);
  }
  
  const data = await res.json();
  
  // Try multiple possible response formats for compatibility
  let content = null;
  
  // OpenAI format: data.choices[0].message.content
  if (data?.choices?.[0]?.message?.content) {
    content = data.choices[0].message.content;
  }
  // Alternative format: data.choices[0].text
  else if (data?.choices?.[0]?.text) {
    content = data.choices[0].text;
  }
  // Direct content format: data.content
  else if (data?.content) {
    content = data.content;
  }
  // Direct response format: data.response
  else if (data?.response) {
    content = data.response;
  }
  // Anthropic format: data.content[0].text
  else if (data?.content?.[0]?.text) {
    content = data.content[0].text;
  }
  
  if (!content || content.trim() === '') {
    console.error('Custom LLM response structure:', JSON.stringify(data).substring(0, 500));
    throw new Error('No response from Custom LLM API. Check console for response structure.');
  }
  
  // Parse JSON from the response
  try {
    // Try to parse the entire content as JSON
    return JSON.parse(content);
  } catch (e) {
    // If that fails, try to extract JSON from markdown code blocks
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || 
                      content.match(/```\s*([\s\S]*?)\s*```/) ||
                      content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      try {
        return JSON.parse(jsonStr);
      } catch (e2) {
        console.error('Failed to parse JSON from custom LLM:', jsonStr.substring(0, 200));
        throw new Error('Invalid JSON in Custom LLM response');
      }
    }
    
    console.error('Could not find JSON in custom LLM response:', content.substring(0, 500));
    throw new Error('Could not extract JSON from Custom LLM response');
  }
}

// ============================================================================
// BATCH PROCESSING FUNCTIONS
// ============================================================================

/**
 * Start batch processing of URLs
 * @param {Array<string>} urls - URLs to process
 */
async function startBatchProcessing(urls) {
  if (!Array.isArray(urls) || urls.length < 1 || urls.length > 100 ||
      urls.some(url => typeof url !== 'string' || url.length > 2048 || !/^https?:\/\//i.test(url))) {
    throw new Error('Batch requires 1 to 100 HTTP(S) URLs under 2048 characters');
  }
  if (batchProcessingActive) {
    throw new Error('Batch processing already active');
  }
  
  // Generate timestamped folder name for this batch
  const batchFolderName = generateBatchFolderName();
  
  // Initialize queue
  const queue = {
    urls: urls.map((url, index) => ({
      url,
      index,
      status: 'pending',
      result: null,
      error: null,
      screenshot: null
    })),
    currentIndex: 0,
    status: 'processing',
    createdAt: Date.now(),
    completedAt: null,
    batchFolderName: batchFolderName  // Store folder name for this batch
  };
  
  await chrome.storage.local.set({ 'batch::queue': queue });
  await updateBatchStatus('initialized', 0, urls.length);
  
  batchProcessingActive = true;
  processNextBatchUrl();
}

/**
 * Generate timestamped folder name for batch processing
 * Format: scamometer-reports-YYYY-MM-DD_HH-MM-SS
 * @param {Date} date - Date object (defaults to now)
 * @returns {string} - Folder name
 */
function generateBatchFolderName(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `scamometer-reports-${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
}

/**
 * Process next URL in batch queue
 */
async function processNextBatchUrl() {
  if (!batchProcessingActive) return;
  
  const data = await chrome.storage.local.get('batch::queue');
  const queue = data['batch::queue'];
  
  if (!queue) {
    batchProcessingActive = false;
    return;
  }
  
  // Find next pending URL
  const nextUrl = queue.urls.find(u => u.status === 'pending');
  
  if (!nextUrl) {
    // All done
    queue.status = 'completed';
    queue.completedAt = Date.now();
    await chrome.storage.local.set({ 'batch::queue': queue });
    await updateBatchStatus('completed', queue.urls.length, queue.urls.length);
    batchProcessingActive = false;
    
    // Send webhook notification
    try {
      const results = {
        total: queue.urls.length,
        completed: queue.urls.filter(u => u.status === 'completed').length,
        failed: queue.urls.filter(u => u.status === 'failed').length,
        pending: queue.urls.filter(u => u.status === 'pending').length,
        results: queue.urls
      };
      await sendWebhookNotification(results);
    } catch (e) {
      console.error('Webhook notification failed:', e);
    }
    
    // Notify popup
    try {
      chrome.runtime.sendMessage({ type: 'BATCH_COMPLETE' });
    } catch {}
    return;
  }
  
  // Mark as processing
  nextUrl.status = 'processing';
  await chrome.storage.local.set({ 'batch::queue': queue });
  await updateBatchStatus('processing', nextUrl.index, queue.urls.length);
  
  try {
    // Open URL in a NEW WINDOW (not tab) for better isolation
    const window = await chrome.windows.create({
      url: nextUrl.url,
      focused: false,
      state: 'minimized',
      type: 'normal'
    });
    
    const tab = window.tabs[0];
    batchTabId = tab.id;
    const batchWindowId = window.id;
    
    // Wait for page to load completely
    await waitForTabLoad(tab.id);
    
    // Additional wait for content script to be ready and dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Run analysis and wait for completion
    await runAnalysis(tab.id, nextUrl.url, { reason: 'batch' });
    
    // Get result immediately - retry mechanism for robustness
    const key = storageKey(nextUrl.url);
    let result = null;
    let retries = 3;
    while (retries > 0 && !result) {
      const resultData = await chrome.storage.local.get(key);
      result = resultData[key];
      if (!result && retries > 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      retries--;
    }
    
    // Show overlay immediately after analysis completes
    await chrome.tabs.sendMessage(tab.id, { 
      type: 'OVERLAY', 
      score: result?.ai?.scamometer || 0 
    }).catch(()=>{});
    
    // Capture screenshot with overlay (MUST complete before closing window)
    const screenshot = await captureScreenshotWithOverlay(tab.id, nextUrl.url, queue.batchFolderName);
    
    // Update queue with result and screenshot
    nextUrl.status = 'completed';
    nextUrl.result = result;
    nextUrl.screenshot = screenshot;
    await chrome.storage.local.set({ 'batch::queue': queue });
    
    // NOW close window after screenshot is captured
    await chrome.windows.remove(batchWindowId).catch(()=>{});
    batchTabId = null;
    
    // Send individual webhook notification for this URL (async, don't block next URL)
    (async () => {
      try {
        const { webhookEnabled = false } = await chrome.storage.local.get({ webhookEnabled: false });
        if (webhookEnabled) {
          await sendWebhookNotification({
            total: 1,
            completed: 1,
            failed: 0,
            pending: 0,
            results: [{
              url: nextUrl.url,
              status: 'completed',
              result: result,
              screenshot: screenshot
            }]
          });
        }
      } catch (e) {
        console.error('Individual webhook notification failed:', e);
      }
    })();
    
    // Process next URL immediately after screenshot is done
    setTimeout(() => processNextBatchUrl(), 100);
    
  } catch (error) {
    console.error('Batch processing error:', error);
    
    // Implement retry logic with exponential backoff
    const maxRetries = 2;
    const currentRetry = nextUrl.retryCount || 0;
    
    if (currentRetry < maxRetries) {
      // Retry this URL
      nextUrl.retryCount = currentRetry + 1;
      nextUrl.status = 'pending';  // Reset to pending for retry
      nextUrl.lastError = error.message;
      await chrome.storage.local.set({ 'batch::queue': queue });
      
      console.log(`Retrying URL ${nextUrl.url} (attempt ${nextUrl.retryCount + 1}/${maxRetries + 1})`);
      
      // Close window/tab if open
      if (batchTabId) {
        try {
          const tab = await chrome.tabs.get(batchTabId);
          await chrome.windows.remove(tab.windowId);
        } catch {}
        batchTabId = null;
      }
      
      // Retry after exponential backoff
      const delay = 2000 * Math.pow(2, currentRetry);
      setTimeout(() => processNextBatchUrl(), delay);
    } else {
      // Max retries exceeded, mark as failed
      nextUrl.status = 'failed';
      nextUrl.error = `Failed after ${maxRetries + 1} attempts: ${error.message}`;
      await chrome.storage.local.set({ 'batch::queue': queue });
      
      // Close window/tab if open
      if (batchTabId) {
        try {
          const tab = await chrome.tabs.get(batchTabId);
          await chrome.windows.remove(tab.windowId);
        } catch {}
        batchTabId = null;
      }
      
      // Continue with next URL
      setTimeout(() => processNextBatchUrl(), 1500);
    }
  }
}

/**
 * Pause batch processing
 */
async function pauseBatchProcessing() {
  batchProcessingActive = false;
  const data = await chrome.storage.local.get('batch::queue');
  const queue = data['batch::queue'];
  if (queue) {
    queue.status = 'paused';
    await chrome.storage.local.set({ 'batch::queue': queue });
    const completed = queue.urls.filter(u => u.status === 'completed' || u.status === 'failed').length;
    await updateBatchStatus('paused', completed, queue.urls.length);
  }
  
  // Close batch tab if open
  if (batchTabId) {
    try {
      await chrome.tabs.remove(batchTabId);
    } catch {}
    batchTabId = null;
  }
}

/**
 * Resume batch processing
 */
async function resumeBatchProcessing() {
  const data = await chrome.storage.local.get('batch::queue');
  const queue = data['batch::queue'];
  if (queue && queue.status === 'paused') {
    queue.status = 'processing';
    await chrome.storage.local.set({ 'batch::queue': queue });
    batchProcessingActive = true;
    processNextBatchUrl();
  }
}

async function stopBatchProcessing() {
  batchProcessingActive = false;
  const data = await chrome.storage.local.get('batch::queue');
  const queue = data['batch::queue'];
  if (queue) {
    queue.status = 'completed';
    await chrome.storage.local.set({ 'batch::queue': queue });
    const completed = queue.urls.filter(u => u.status === 'completed').length;
    const failed = queue.urls.filter(u => u.status === 'failed').length;
    await updateBatchStatus('completed', completed + failed, queue.urls.length);
  }
}

/**
 * Wait for tab to finish loading
 * @param {number} tabId - Tab ID
 * @returns {Promise<void>}
 */
function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      listener && chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timeout'));
    }, 30000);
    
    const listener = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        // Wait a bit more for dynamic content
        setTimeout(() => resolve(), 2000);
      }
    };
    
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Capture screenshot with timestamp overlay
 * @param {number} tabId - Tab ID
 * @param {string} url - Page URL
 * @param {string} batchFolderName - Optional batch folder name for organized storage
 * @returns {Promise<Object>} - Screenshot info
 */
async function captureScreenshotWithOverlay(tabId, url, batchFolderName = null) {
  try {
    // Get the tab and make window visible for screenshot
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { 
      state: 'normal',
      focused: true 
    });
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Inject overlay with URL and timestamp
    const timestamp = formatTimestamp(new Date());
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (url, timestamp) => {
        const overlay = document.createElement('div');
        overlay.id = 'scamometer-screenshot-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        overlay.style.color = 'white';
        overlay.style.padding = '16px 20px';
        overlay.style.zIndex = '2147483647';
        overlay.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        overlay.style.fontSize = '14px';
        overlay.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        overlay.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div style="font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">🧪 ${url}</div>
            <div style="margin-left:20px; white-space:nowrap; font-weight:600;">${timestamp}</div>
          </div>
        `;
        document.body.appendChild(overlay);
      },
      args: [url, timestamp]
    });
    
    // Wait for overlay to render
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Capture screenshot
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png', quality: 100 });
    
    // Remove overlay
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const overlay = document.getElementById('scamometer-screenshot-overlay');
        if (overlay) overlay.remove();
      }
    }).catch(() => {}); // Ignore errors if tab is closed
    
    // Calculate SHA-256 hash
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
      view[i] = binary.charCodeAt(i);
    }
    
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    // Create filename with timestamp for better organization
    const hostname = new URL(url).hostname.replace(/[^a-z0-9]/gi, '_');
    const filename = `${hostname}_${hash.substring(0, 12)}.png`;
    
    // Determine download path
    let downloadPath;
    if (batchFolderName) {
      // For batch processing: save to timestamped folder with screenshots subfolder
      downloadPath = `${batchFolderName}/screenshots/${filename}`;
    } else {
      // For single analysis: save to main scamometer_reports folder
      downloadPath = `scamometer_reports/${filename}`;
    }
    
    // Download screenshot
    await chrome.downloads.download({
      url: dataUrl,
      filename: downloadPath,
      saveAs: false
    });
    
    return {
      hash,
      timestamp,
      filename: filename,
      relativePath: batchFolderName ? `screenshots/${filename}` : filename
      // No dataUrl - HTML reports will use relative paths to the downloaded files
    };
  } catch (error) {
    console.error('Screenshot capture failed:', error);
    // Return null if screenshot fails, but don't fail the whole analysis
    return null;
  }
}

/**
 * Format timestamp as YYYY-MM-DD HH:MM:SS
 * @param {Date} date - Date object
 * @returns {string} - Formatted timestamp
 */
function formatTimestamp(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Update batch status
 * @param {string} status - Status message
 * @param {number} current - Current index
 * @param {number} total - Total URLs
 */
async function updateBatchStatus(status, current, total) {
  await chrome.storage.local.set({
    'batch::status': {
      status,
      current,
      total,
      percentage: total > 0 ? Math.round((current / total) * 100) : 0,
      timestamp: Date.now()
    }
  });
}

