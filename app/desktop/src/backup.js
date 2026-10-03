// Settings backup and restore (U08): one file out, one file in, versioned.
//
// The reinstall story today is screenshots of Settings. This module
// snapshots a localStorage-shaped store ({getItem,setItem,key,length or
// keys()}) into {version, at, values} and writes it back, with two rules:
// secret-shaped keys never leave in an export and never land in an import,
// and an import only touches keys the current build knows (KNOWN_KEYS), so
// restoring a backup from a newer version cannot plant unknown state.
// Provider keys live in the OS keyring, not localStorage, and are doubly
// excluded: by shape and by never being in KNOWN_KEYS.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UBackup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = 1;

  // Settings keys the current build understands (both naming styles exist:
  // freeai4u-theme and freeai4u.accent). Restoring anything else is how a
  // backup from the future corrupts the present. Chat content, histories
  // and logs are deliberately absent: they are data with their own exports,
  // not settings, and some are bigger than a backup should be.
  var KNOWN_KEYS = [
    'freeai4u-theme', 'freeai4u.theme', 'freeai4u.accent',
    'freeai4u.updateChannel', 'freeai4u.updateDismissed',
    'freeai4u.sidebar.hidden', 'freeai4u.localRoot', 'freeai4u.engine',
    'freeai4u.server', 'freeai4u.traces', 'freeai4u.machine',
    'freeai4u.vram', 'freeai4u.selection', 'freeai4u.window',
    'freeai4u.dictation', 'freeai4u.whisper', 'freeai4u.mintPack.dismissed',
    'freeai4u.skillRouting.reasons', 'freeai4u.design', 'freeai4u.images.choice',
    'freeai4u.code', 'freeai4u.buildModel', 'freeai4u.buildProvider',
    'freeai4u.docker', 'freeai4u.evals', 'freeai4u.flux', 'freeai4u.mcp',
    'freeai4u.saved', 'freeai4u.sd.loras', 'freeai4u.tools',
    'neuraos.telemetry', 'neuraos.voice', 'neuraos.screen',
  ];

  // Anything shaped like a credential is denied in both directions, even if
  // it somehow lands in KNOWN_KEYS later: the shape check runs first.
  // (freeai4u.hf_token exists in localStorage on web builds without a
  // keyring -- the shape is what catches it, not the allowlist.)
  var SECRET_SHAPE = /token|secret|password|passwd|auth|bearer|api[-_ ]?key|private|credential|session|byok/i;

  // Content, not settings: chats, threads, histories, logs, recipes.
  var CONTENT_SHAPE = /chats|thread|inbox|composer|handoff|history|audit|recipes|\.csv|\.json$/i;

  function denied(key) {
    return SECRET_SHAPE.test(String(key || ''));
  }

  function readKeys(store) {
    if (typeof store.keys === 'function') return store.keys();
    var out = [];
    var n = Number(store.length) || 0;
    for (var i = 0; i < n; i += 1) {
      var k = null;
      try { k = store.key(i); } catch (e) { k = null; }
      if (k != null) out.push(k);
    }
    return out;
  }

  function exportBackup(store) {
    var values = {};
    var skipped = [];
    var keys = readKeys(store || {});
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (denied(key)) { skipped.push(key); continue; }
      if (CONTENT_SHAPE.test(key) && KNOWN_KEYS.indexOf(key) < 0) continue;
      var value = null;
      try { value = store.getItem(key); } catch (e) { value = null; }
      if (value != null) values[key] = String(value);
    }
    return { version: VERSION, at: new Date().toISOString(), values: values, skippedSecrets: skipped };
  }

  function importBackup(doc, store) {
    var result = { restored: [], skipped: [], errors: [] };
    if (!doc || typeof doc !== 'object' || doc.version !== VERSION || !doc.values || typeof doc.values !== 'object') {
      result.errors.push('not a NeuraOS settings backup (version 1)');
      return result;
    }
    var keys = Object.keys(doc.values);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (denied(key) || KNOWN_KEYS.indexOf(key) < 0) { result.skipped.push(key); continue; }
      try {
        store.setItem(key, String(doc.values[key]));
        result.restored.push(key);
      } catch (e) {
        result.errors.push(key + ': ' + String((e && e.message) || e));
      }
    }
    return result;
  }

  return {
    VERSION: VERSION,
    KNOWN_KEYS: KNOWN_KEYS,
    denied: denied,
    exportBackup: exportBackup,
    importBackup: importBackup,
  };
});
