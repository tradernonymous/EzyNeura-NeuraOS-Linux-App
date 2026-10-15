// CCE-style provider manager for standalone NeuraOS (like Claude Desktop).
// UMD: node gets module.exports, app gets global FreeAI4UCceProviders.
// - 12 curated presets (engine LLM_PROVIDERS ids) + models.dev catalog cache
// - star/default/disable in localStorage, keys in OS keyring `provider.<id>`
// - chat, coding and image all read the same rows via api.providers()
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UCceProviders = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var STAR_KEY = 'neuraos.cce.star';
  var DISABLED_KEY = 'neuraos.cce.disabled';
  var CATALOG_KEY = 'neuraos.cce.catalog';
  var CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
  var CATALOG_URL = 'https://models.dev/api.json';

  var PRESETS = [
    { id: 'kilocode', label: 'Kilocode', kind: 'free', note: 'Keyless free floor — works with no key' },
    { id: 'ovhcloud', label: 'OVHcloud', kind: 'free', note: 'Keyless, 2 req/min shared IP' },
    { id: 'pollinations', label: 'Pollinations', kind: 'image', note: 'Keyless image + free chat' },
    { id: 'nara', label: 'Nara', kind: 'cloud', envVar: 'NARA_API_KEY' },
    { id: 'openrouter', label: 'OpenRouter', kind: 'cloud', envVar: 'OPENROUTER_API_KEY' },
    { id: 'nvidia', label: 'NVIDIA', kind: 'cloud', envVar: 'NVIDIA_API_KEY' },
    { id: 'groq', label: 'Groq', kind: 'cloud', envVar: 'GROQ_API_KEY' },
    { id: 'mistral', label: 'Mistral', kind: 'cloud', envVar: 'MISTRAL_API_KEY' },
    { id: 'openai', label: 'OpenAI', kind: 'cloud', envVar: 'OPENAI_API_KEY' },
    { id: 'gemini', label: 'Gemini', kind: 'cloud', envVar: 'GEMINI_API_KEY' },
    { id: 'cloudflare', label: 'Cloudflare', kind: 'cloud', envVar: 'CLOUDFLARE_API_TOKEN' },
    { id: 'alibaba', label: 'Alibaba (Qwen)', kind: 'cloud', envVar: 'ALIBABA_API_KEY' },
    { id: 'huggingface', label: 'Hugging Face', kind: 'cloud', envVar: 'HF_TOKEN' },
    { id: 'deepseek', label: 'DeepSeek', kind: 'cloud', envVar: 'DEEPSEEK_API_KEY' },
    { id: 'together', label: 'Together AI', kind: 'cloud', envVar: 'TOGETHER_API_KEY' },
    { id: 'fireworks', label: 'Fireworks AI', kind: 'cloud', envVar: 'FIREWORKS_API_KEY' },
    { id: 'xai', label: 'xAI (Grok)', kind: 'cloud', envVar: 'XAI_API_KEY' },
    { id: 'perplexity', label: 'Perplexity', kind: 'cloud', envVar: 'PERPLEXITY_API_KEY' },
    { id: 'cohere', label: 'Cohere', kind: 'cloud', envVar: 'COHERE_API_KEY' },
    { id: 'moonshot', label: 'Moonshot (Kimi)', kind: 'cloud', envVar: 'MOONSHOT_API_KEY' },
    { id: 'zhipu', label: 'Zhipu (GLM)', kind: 'cloud', envVar: 'ZHIPU_API_KEY' },
    { id: 'freebuff', label: 'FreeBuff proxy', kind: 'gateway', envVar: 'FREEBUFF_API_KEY' },
  ];

  function storage() {
    try { return (typeof globalThis !== 'undefined' ? globalThis : {}).localStorage || null; } catch { return null; }
  }
  function readJson(key, fallback) {
    try {
      var s = storage(); if (!s) return fallback;
      var raw = s.getItem(key); if (!raw) return fallback;
      return JSON.parse(raw);
    } catch { return fallback; }
  }
  function writeJson(key, value) {
    try { var s = storage(); if (!s) return false; s.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  function starred() { return String(readJson(STAR_KEY, '') || ''); }
  function setStarred(id) { return writeJson(STAR_KEY, String(id || '')); }
  function disabled() { var v = readJson(DISABLED_KEY, []); return Array.isArray(v) ? v : []; }
  function setDisabled(ids) { return writeJson(DISABLED_KEY, ids); }
  function isDisabled(id) { return disabled().indexOf(String(id)) >= 0; }
  function toggleDisabled(id) {
    var list = disabled(); var i = list.indexOf(String(id));
    if (i >= 0) list.splice(i, 1); else list.push(String(id));
    setDisabled(list); return list;
  }

  // models.dev catalog, 24h cache, offline fallback to presets.
  async function catalog(fetchImpl) {
    var cached = readJson(CATALOG_KEY, null);
    if (cached && cached.at && (Date.now() - cached.at) < CATALOG_TTL_MS && cached.data) return cached.data;
    var doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
    if (!doFetch) return null;
    try {
      var res = await doFetch(CATALOG_URL, { cache: 'no-store' });
      if (!res || !res.ok) return (cached && cached.data) || null;
      var data = await res.json();
      writeJson(CATALOG_KEY, { at: Date.now(), data: data });
      return data;
    } catch { return (cached && cached.data) || null; }
  }

  function secretKey(id) { return 'provider.' + String(id || '').toLowerCase().replace(/[^a-z0-9-_]/g, ''); }

  return {
    STAR_KEY: STAR_KEY, DISABLED_KEY: DISABLED_KEY, CATALOG_URL: CATALOG_URL,
    PRESETS: PRESETS, starred: starred, setStarred: setStarred,
    disabled: disabled, setDisabled: setDisabled, isDisabled: isDisabled,
    toggleDisabled: toggleDisabled, catalog: catalog, secretKey: secretKey,
  };
});
