# Scamometer

Scamometer is Arnab Mandal's Manifest V3 browser extension for phishing and scam assessment. It combines page-text analysis using optional AI providers with DNS and RDAP lookups, then displays an explainable risk score. It has a dual-model summarizer/judge path, batch scans, history, local exports, allow/block lists and an optional results webhook. **EviDistill** is the related teacher-student research direction; the extension does not train a model locally or prove the research claims by itself.

A score is a screening aid, not proof that a site is safe or malicious. Do not rely on it as your only security control. Response times and accuracy depend on network, provider, model and page; no benchmark or zero-false-positive claim is made here.

## Install and first scan

1. Clone or download [vio137/scamometer](https://github.com/vio137/scamometer). In `chrome://extensions`, enable Developer mode, choose **Load unpacked**, then select this repository folder.
2. Open **Options** and configure the verdict model (Model B) with your own API key. Model A is optional and summarizes page text before Model B's verdict. Supported providers are Gemini, Cerebras and a user-configured API endpoint; check each provider's costs and data practices.
3. Open the popup and turn scanning **ON** to begin automatic analysis on HTTP(S) pages. It starts **OFF** on a fresh installation. The extension can read page content on visited sites while enabled. Do not turn it on for sensitive pages if their text must not be shared with an AI provider. Turn it off again in the popup.
4. Open popup reports for the verdict, context and evidence. Batch, screenshots and export are optional functions that may require user interaction and supported browser pages.

The optional webhook is disabled by default. If enabled, scan URLs, scores, reasons and optional screenshots are sent to the HTTPS URL you enter. URLs and screenshots can contain personal information. Do not use an untrusted destination. Settings, keys and scan history reside in Chrome local storage; clearing extension data deletes them.

## Permissions and publication checklist

- `<all_urls>` and a content script are required for the primary automatic scanning feature across arbitrary sites, and for user-chosen batch targets. Scans only process HTTP(S) pages. The extension requests page text for analysis and may send it to the selected AI provider. DNS and RDAP requests go to their configured providers. This is not local-only detection.
- `tabs` supports scans on navigation and optional batch tabs; `storage` stores settings and reports; `scripting` supports optional screenshot overlay; `downloads` saves reports; `activeTab` is used for interactive capture.
- Review the settings disclosure, data fields and optional webhook with a privacy reviewer. Host an accurate public privacy policy and complete Chrome Web Store data-use declarations before submission. Package only the extension files, provide screenshots and a clear single-purpose listing. Test with a clean Chrome profile and with real provider credentials owned by the tester. Review approval is Google's decision, not guaranteed by this repository.

See [PRIVACY.md](PRIVACY.md) for a source-level data inventory. There is no automated suite or verified performance benchmark in this repository. Run `node --check` over `js/*.js` and validate `manifest.json`; use browser tests for scan, error, popup, exports and webhook before shipping.

Copyright Arnab Mandal. [MIT license](LICENSE). [Issues](https://github.com/vio137/scamometer/issues).
