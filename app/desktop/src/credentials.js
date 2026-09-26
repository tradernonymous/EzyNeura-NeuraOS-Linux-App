// C10 (upgrade plan): the credential broker's front half — the index of
// saved profiles, and the validation rules that mirror broker.rs.
//
// The secrets themselves NEVER live here. This module decides what may be
// written into the OS keyring (secret_set -> secrets.rs) and keeps a
// non-secret index in localStorage — name, kind and one line of detail —
// so Settings -> Credentials can draw the list without reading a single
// keyring entry back into the page. The tools (ssh_run / http_auth) pass
// only a profile's NAME; broker.rs reads the value and returns only the
// command's output or the request's answer.
//
// The rules below are broker.rs's rules, deliberately duplicated: the form
// is refused before a keyring entry exists, and the shell refuses again
// before a process is spawned. UMD like the repo's other shared modules.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UCredentials = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  var KEY = 'freeai4u.credential_profiles';
  var SSH_PREFIX = 'ssh.';
  var API_PREFIX = 'api.';
  var CAP = 100;

  function storage(given) {
    if (given) return given;
    try {
      var scope = typeof globalThis !== 'undefined' ? globalThis : {};
      return scope.localStorage || null;
    } catch {
      return null;
    }
  }

  /** The id rule broker.rs and secrets.rs enforce (byok's shape). */
  function isId(name) {
    var s = String(name == null ? '' : name);
    return s.length > 0 && s.length <= 64 && s.indexOf('..') < 0 &&
      /^[a-z0-9._-]+$/.test(s);
  }

  function validKind(kind) {
    return kind === 'ssh' || kind === 'api';
  }

  /** The keyring key a profile is stored under, or '' when the name refuses. */
  function keyFor(kind, name) {
    if (!validKind(kind) || !isId(name)) return '';
    return (kind === 'ssh' ? SSH_PREFIX : API_PREFIX) + name;
  }

  var USER = /^[A-Za-z0-9._-]{1,64}$/;
  var HOST = /^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/;
  var HEADER = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

  /**
   * The form's input -> the JSON string broker.rs will read back.
   * { profile } on success, { error } in the person's words. The identity
   * (private key) goes INTO the profile string and nowhere else — never
   * into the index this module keeps.
   */
  function sshProfile(input) {
    var i = input || {};
    var user = String(i.user || '').trim();
    var host = String(i.host || '').trim();
    if (!USER.test(user)) return { error: 'A user name is letters, digits, dot, dash or underscore (as in jack@nas.local).' };
    if (!HOST.test(host) || host.charAt(0) === '-') return { error: 'That does not look like a host name or address.' };
    var profile = { user: user, host: host };
    var port = String(i.port || '').trim();
    if (port) {
      var n = Number(port);
      if (!Number.isInteger(n) || n < 1 || n > 65535) return { error: 'A port is a number from 1 to 65535.' };
      profile.port = n;
    }
    var identity = String(i.identity || '');
    if (identity.trim()) {
      if (identity.length > 32768 || identity.indexOf('\0') >= 0) return { error: 'That private key is too long to store.' };
      profile.identity = identity;
    }
    return { profile: JSON.stringify(profile), detail: user + '@' + host + (port ? ':' + port : '') };
  }

  /** The form's input -> the JSON string broker.rs will read back. */
  function apiProfile(input) {
    var i = input || {};
    var base = String(i.base || '').trim();
    var url;
    try {
      url = new URL(base);
    } catch {
      return { error: 'A base address like https://api.example.com/v1.' };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'The address must be http or https.' };
    if (url.username || url.password) return { error: 'Put the login in the secret, not in the address.' };
    if (!url.hostname) return { error: 'The address has no host.' };
    var header = String(i.header || '').trim() || 'Authorization';
    if (!HEADER.test(header)) return { error: 'That is not a header name (try Authorization).' };
    var prefix = String(i.prefix == null ? '' : i.prefix);
    if (!prefix) prefix = 'Bearer ';
    if (prefix.length > 64 || /[\r\n\0]/.test(prefix)) return { error: 'The prefix does not belong in a header.' };
    var secret = String(i.secret || '');
    if (!secret) return { error: 'A secret to send is the point of the entry.' };
    if (secret.length > 16384 || secret.indexOf('\0') >= 0) return { error: 'That secret is too long to store.' };
    var clean = url.origin + url.pathname.replace(/\/+$/, '') + url.search;
    return {
      profile: JSON.stringify({ base: clean, header: header, prefix: prefix, secret: secret }),
      detail: url.host + url.pathname.replace(/\/+$/, ''),
    };
  }

  function read(given) {
    var box = storage(given);
    if (!box) return [];
    try {
      var list = JSON.parse(box.getItem(KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function write(given, list) {
    var box = storage(given);
    if (!box) return false;
    try {
      box.setItem(KEY, JSON.stringify(list.slice(0, CAP)));
      return true;
    } catch {
      return false;
    }
  }

  /** The index: [{ kind, name, detail }] — never a secret, never a key. */
  function list(given) {
    return read(given).filter(function (e) {
      return e && validKind(e.kind) && isId(e.name);
    });
  }

  /** Add or replace one index row (upsert by kind + name). */
  function remember(kind, name, detail, given) {
    if (!validKind(kind) || !isId(name)) return false;
    var next = read(given).filter(function (e) {
      return !(e && e.kind === kind && e.name === name);
    });
    next.unshift({
      kind: kind,
      name: name,
      detail: String(detail || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      at: Date.now(),
    });
    return write(given, next);
  }

  function forget(kind, name, given) {
    var next = read(given).filter(function (e) {
      return !(e && e.kind === kind && e.name === name);
    });
    return write(given, next);
  }

  return {
    KEY: KEY,
    SSH_PREFIX: SSH_PREFIX,
    API_PREFIX: API_PREFIX,
    CAP: CAP,
    isId: isId,
    validKind: validKind,
    keyFor: keyFor,
    sshProfile: sshProfile,
    apiProfile: apiProfile,
    list: list,
    remember: remember,
    forget: forget,
  };
});
