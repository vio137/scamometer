// Built by Arnab Mandal — contact: hello@arnabmandal.com
// Webhook integration for external system callbacks

/**
 * Webhook configuration stored in chrome.storage.local
 * {
 *   webhookUrl: string,  // URL to send POST requests to
 *   webhookEnabled: boolean,  // Whether webhook is enabled
 *   webhookAuth: string  // Optional auth header value
 * }
 */

/**
 * Send batch results to configured webhook
 * @param {Object} results - Batch results object
 * @returns {Promise<boolean>} - Success status
 */
function isHttpsWebhook(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

export async function sendWebhookNotification(results) {
  const { webhookUrl, webhookEnabled, webhookAuth } = await chrome.storage.local.get({
    webhookUrl: null,
    webhookEnabled: false,
    webhookAuth: null
  });
  
  if (!webhookEnabled || !webhookUrl || !isHttpsWebhook(webhookUrl)) {
    console.log('Webhook not configured or disabled');
    return false;
  }
  
  try {
    const payload = {
      timestamp: Date.now(),
      completed: new Date().toISOString(),
      summary: {
        total: results.total,
        completed: results.completed,
        failed: results.failed,
        pending: results.pending
      },
      results: results.results.map(r => ({
        url: r.url,
        status: r.status,
        score: r.result?.ai?.scamometer ?? null,
        verdict: r.result?.ai?.verdict || null,
        reason: r.result?.ai?.reason || null,
        error: r.error || null,
        screenshot: r.screenshot || null
      }))
    };
    
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (webhookAuth) {
      headers['Authorization'] = webhookAuth;
    }
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      console.error('Webhook failed:', response.status, await response.text());
      return false;
    }
    
    console.log('Webhook notification sent successfully');
    return true;
    
  } catch (error) {
    console.error('Webhook error:', error);
    return false;
  }
}

/**
 * Test webhook configuration
 * @param {string} url - Webhook URL
 * @param {string} auth - Optional auth header
 * @returns {Promise<Object>} - Test result
 */
export async function testWebhook(url, auth = null) {
  if (!isHttpsWebhook(url)) return { ok: false, error: "HTTPS webhook URL required" };
  try {
    const headers = {
      'Content-Type': 'application/json'
    };
    
    if (auth) {
      headers['Authorization'] = auth;
    }
    
    const testPayload = {
      test: true,
      timestamp: Date.now(),
      message: 'Scamometer webhook test'
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(testPayload)
    });
    
    return {
      success: response.ok,
      status: response.status,
      message: response.ok ? 'Webhook test successful' : `HTTP ${response.status}`
    };
    
  } catch (error) {
    return {
      success: false,
      status: 0,
      message: error.message
    };
  }
}

/**
 * Simple local webhook server implementation
 * Note: Chrome extensions cannot run actual servers, but we can listen for
 * messages from external sources via chrome.runtime.onMessageExternal
 */

/**
 * Register webhook listener for external messages
 * External websites can trigger batch processing by sending messages if allowed
 */
export function registerWebhookListener() {
  // Listen for external messages (from whitelisted domains)
  chrome.runtime.onMessageExternal.addListener(async (message, sender, sendResponse) => {
    console.log('External message received:', message, 'from:', sender);
    
    // Verify sender is allowed
    const { allowedDomains } = await chrome.storage.local.get({ allowedDomains: [] });
    const senderOrigin = new URL(sender.url).origin;
    
    if (!allowedDomains.includes(senderOrigin)) {
      sendResponse({ error: 'Domain not whitelisted for webhook access' });
      return;
    }
    
    // Handle different message types
    if (message.type === 'START_BATCH' && Array.isArray(message.urls)) {
      try {
        // Start batch processing
        await chrome.runtime.sendMessage({ type: 'START_BATCH', urls: message.urls });
        sendResponse({ success: true, message: 'Batch processing started' });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    } else if (message.type === 'GET_STATUS') {
      try {
        const status = await chrome.runtime.sendMessage({ type: 'GET_BATCH_STATUS' });
        sendResponse({ success: true, status });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    } else if (message.type === 'GET_RESULTS') {
      try {
        const results = await chrome.runtime.sendMessage({ type: 'GET_BATCH_RESULTS' });
        sendResponse({ success: true, results });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    } else {
      sendResponse({ error: 'Unknown message type' });
    }
    
    return true; // Keep channel open for async response
  });
}

/**
 * Add domain to webhook whitelist
 * @param {string} domain - Domain to allow (e.g., 'https://example.com')
 */
export async function addWebhookDomain(domain) {
  const { allowedDomains = [] } = await chrome.storage.local.get({ allowedDomains: [] });
  
  // Validate domain format
  try {
    new URL(domain);
  } catch (e) {
    throw new Error('Invalid domain URL format');
  }
  
  if (!allowedDomains.includes(domain)) {
    allowedDomains.push(domain);
    await chrome.storage.local.set({ allowedDomains });
  }
}

/**
 * Remove domain from webhook whitelist
 * @param {string} domain - Domain to remove
 */
export async function removeWebhookDomain(domain) {
  const { allowedDomains = [] } = await chrome.storage.local.get({ allowedDomains: [] });
  const filtered = allowedDomains.filter(d => d !== domain);
  await chrome.storage.local.set({ allowedDomains: filtered });
}

/**
 * Get list of whitelisted webhook domains
 * @returns {Promise<Array<string>>} - Array of domains
 */
export async function getWebhookDomains() {
  const { allowedDomains = [] } = await chrome.storage.local.get({ allowedDomains: [] });
  return allowedDomains;
}
