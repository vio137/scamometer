# Scamometer privacy information

When you turn scanning on, Scamometer reads HTTP(S) page text and URL to analyze potential scam and phishing signals. It requests DNS and RDAP information about domains from public resolver/registry services and sends a bounded representation of page content and metadata to the AI provider you configure (Gemini, Cerebras or a custom endpoint). Provider processing and charges follow your provider account and terms. The extension is not a guarantee of site safety.

Settings, API keys, allow/block lists, scan results, optional screenshots and batch history are stored in Chrome local extension storage. They are not synced by this code. You can clear scan cache or all stored settings in Options, disable scanning in the popup, or uninstall the extension.

If you explicitly enable a webhook, the extension posts individual and batch results to your selected HTTPS endpoint. Those results may contain page URLs, scores, reasons, errors and optional screenshot content. A URL or screenshot can contain personal information. Do not enable a destination that you do not trust. Webhook delivery is off by default.

The source has no developer-operated telemetry or advertising. Before publishing, verify this statement against the packaged code, host an accurate policy on a public URL, and complete the Web Store privacy disclosure and permission justifications. This file describes the source version, not a promise about other releases.
