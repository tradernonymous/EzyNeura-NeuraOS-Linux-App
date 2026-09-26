// Skills from any GitHub repository (upgrade plan B1) — a marketplace file
// or a plain `<name>/SKILL.md` layout — with each skill's references/ folder
// installed beside it (B8). The engine already routes SKILL.md; this module
// is only the source: given something meant to be a repository, it answers
// with the bundles that repo offers and where every byte comes from.
//
// The rules that matter are the ones hf-skills.js already proved: the
// catalogue is hostile, so a URL is parsed and its host checked before any
// request, every path is segment-encoded, and discovery reads a repo's tree
// once instead of probing file by file. What is written to disk stays
// hf-skills.js's decision (planInstall + the lint); entries produced here
// only carry a `rawBase` so the installer fetches from raw.githubusercontent
// instead of the Hugging Face Hub.
//
// UMD like the repo's other shared modules.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FreeAI4UGhSkills = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var API = 'https://api.github.com';
  var RAW = 'https://raw.githubusercontent.com';
  // One repo's tree, one marketplace, and a cap so a mono-repo with 400
  // skills does not become 400 rows in a card list.
  var MAX_BUNDLES = 40;

  /**
   * parseRepo(input) -> { owner, repo, ref } or { error }.
   *
   * Accepts https://github.com/owner/repo (any trailing path is dropped),
   * git@github.com:owner/repo.git, and bare owner/repo. The host is checked:
   * only github.com is a GitHub source, and anything that could read as an
   * option or a foreign host is refused before a request is made.
   */
  function parseRepo(input) {
    var raw = String(input == null ? '' : input).trim();
    if (!raw) return { error: 'Paste a GitHub repository: a URL, or owner/repo.' };
    if (raw.indexOf('ext::') === 0 || raw.charAt(0) === '-') {
      return { error: 'That does not look like a repository.' };
    }
    var ref = '';
    var at = raw.indexOf('#');
    if (at >= 0) {
      ref = raw.slice(at + 1).trim();
      raw = raw.slice(0, at).trim();
    }
    var owner = '';
    var repo = '';
    var https = raw.match(/^https?:\/\/github\.com\/([^\/?#]+)\/([^\/?#]+)/i);
    var ssh = raw.match(/^git@github\.com:([^\/?#]+)\/([^\/?#]+)$/i);
    var bare = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
    if (https) {
      owner = https[1];
      repo = https[2];
    } else if (ssh) {
      owner = ssh[1];
      repo = ssh[2];
    } else if (bare) {
      owner = bare[1];
      repo = bare[2];
    } else {
      return { error: 'Only github.com URLs, git@github.com:owner/repo, or owner/repo are accepted.' };
    }
    repo = repo.replace(/\.git$/i, '');
    if (owner === '.' || repo === '.' || owner === '..' || repo === '..') {
      return { error: 'That does not look like a repository.' };
    }
    if (ref && !/^[A-Za-z0-9._/-]{1,120}$/.test(ref)) {
      return { error: 'That branch name does not look like one.' };
    }
    return { owner: owner, repo: repo, ref: ref };
  }

  /** The API URL for a repository's whole tree (HEAD = the default branch). */
  function treeUrl(owner, repo, ref) {
    return API + '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) +
      '/git/trees/' + encodeURIComponent(ref || 'HEAD') + '?recursive=1';
  }

  /** The raw base every file of this repo/branch is fetched from. */
  function rawBase(owner, repo, ref) {
    return RAW + '/' + owner + '/' + repo + '/' + (ref || 'main');
  }

  /** A raw URL for one file: every segment encoded, never the whole path. */
  function rawFileUrl(base, relPath) {
    var segments = String(relPath == null ? '' : relPath).split('/');
    var encoded = [];
    for (var i = 0; i < segments.length; i++) {
      if (segments[i]) encoded.push(encodeURIComponent(segments[i]));
    }
    return String(base).replace(/\/+$/, '') + '/' + encoded.join('/');
  }

  function jsonFetch(url, fetchImpl) {
    var f = typeof fetchImpl === 'function' ? fetchImpl : fetch;
    return f(url, { headers: { Accept: 'application/vnd.github+json' } }).then(function (res) {
      if (res.status === 403 || res.status === 429) {
        throw new Error('GitHub said no more requests for now (its unauthenticated rate limit). Try again in a minute.');
      }
      if (res.status === 404) {
        throw new Error('That repository or branch was not found on GitHub — check the URL.');
      }
      if (!res.ok) throw new Error('GitHub answered ' + res.status + ' for ' + url + '.');
      return res.json();
    });
  }

  /** The tree's blob paths, as { path } strings; trees (folders) are dropped. */
  function parseTree(json) {
    var out = [];
    var entries = (json && Array.isArray(json.tree)) ? json.tree : [];
    for (var i = 0; i < entries.length; i += 1) {
      var e = entries[i];
      if (e && e.type === 'blob' && typeof e.path === 'string') out.push(e.path);
    }
    return out;
  }

  /**
   * parseMarketplace(text) -> [{ name, dir }] or null.
   *
   * `.claude-plugin/marketplace.json`: `{ plugins: [ { name, skills } ] }`
   * where each `skills` entry is a path to a skill folder (or to SKILL.md
   * itself) or an object with a path. Anything unrecognised is skipped, and
   * a marketplace that lists nothing usable is null — the caller falls back
   * to the tree layout rather than showing an empty offer.
   */
  function parseMarketplace(text) {
    var data;
    try {
      data = JSON.parse(String(text == null ? '' : text));
    } catch {
      return null;
    }
    var plugins = data && Array.isArray(data.plugins) ? data.plugins : [];
    var out = [];
    for (var i = 0; i < plugins.length; i += 1) {
      var plugin = plugins[i] || {};
      var skills = Array.isArray(plugin.skills) ? plugin.skills : [];
      for (var j = 0; j < skills.length; j += 1) {
        var entry = skills[j];
        var path = typeof entry === 'string' ? entry : (entry && (entry.path || entry.source)) || '';
        path = String(path).trim().replace(/^\.\//, '');
        if (!path) continue;
        if (/\/SKILL\.md$/i.test(path)) path = path.slice(0, path.lastIndexOf('/'));
        else if (/^SKILL\.md$/i.test(path)) path = '';
        if (!path) continue;
        var label = (entry && typeof entry === 'object' && (entry.name || entry.title)) ||
          (plugin.name ? plugin.name + ' / ' + lastSegment(path) : lastSegment(path));
        out.push({ name: String(label), dir: path });
      }
    }
    return out.length ? out : null;
  }

  function lastSegment(p) {
    var s = String(p || '').replace(/\/+$/, '');
    var at = s.lastIndexOf('/');
    return at < 0 ? s : s.slice(at + 1);
  }

  /**
   * skillsInTree(paths) -> [{ name, dir }] — every `…/SKILL.md` blob is one
   * bundle, named by the folder it sits in. A repo with a marketplace is
   * offered through that instead; this is the plain layout.
   */
  function skillsInTree(paths) {
    var list = paths || [];
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      var p = list[i];
      if (!/(^|\/)SKILL\.md$/i.test(p)) continue;
      var dir = p.indexOf('/') < 0 ? '' : p.slice(0, p.lastIndexOf('/'));
      var name = dir ? lastSegment(dir) : lastSegment(p);
      out.push({ name: name, dir: dir });
    }
    out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    return out;
  }

  /**
   * referencesInTree(paths, dir) -> the skill's `references/` files, as
   * paths relative to the skill's own folder (B8: they install beside the
   * SKILL.md, inside hf-skills.js's existing ceilings). The `references/`
   * segment stays in the path because that is what the install plan joins
   * against; nested files count.
   */
  function referencesInTree(paths, dir) {
    var prefix = dir ? dir + '/' : '';
    var base = prefix + 'references/';
    var out = [];
    var list = paths || [];
    for (var i = 0; i < list.length; i += 1) {
      var p = list[i];
      if (p.indexOf(base) !== 0) continue;
      out.push(p.slice(prefix.length));
    }
    out.sort();
    return out;
  }

  /**
   * discover(input, fetchImpl) -> { owner, repo, ref, rawBase, bundles: [...] }
   * or { error }. One tree call says whether the repo wears a marketplace or
   * the plain layout, and lists every reference folder at the same time.
   */
  async function discover(input, fetchImpl) {
    var parsed = parseRepo(input);
    if (parsed.error) return { error: parsed.error };
    var meta;
    try {
      meta = await jsonFetch(
        API + '/repos/' + encodeURIComponent(parsed.owner) + '/' + encodeURIComponent(parsed.repo),
        fetchImpl,
      );
    } catch (e) {
      return { error: (e && e.message) || 'Could not reach that repository on GitHub.' };
    }
    // raw.githubusercontent cannot resolve HEAD, so the branch is known before
    // any file is fetched: the one the user named, or the repo's default.
    var ref = parsed.ref || (meta && meta.default_branch) || 'main';
    var tree;
    try {
      tree = await jsonFetch(treeUrl(parsed.owner, parsed.repo, ref), fetchImpl);
    } catch (e) {
      return { error: (e && e.message) || 'Could not read that repository on GitHub.' };
    }
    var paths = parseTree(tree);
    var base = rawBase(parsed.owner, parsed.repo, ref);

    var bundles = [];
    var market = paths.indexOf('.claude-plugin/marketplace.json') >= 0;
    if (market) {
      var text = await fetchText(rawFileUrl(base, '.claude-plugin/marketplace.json'), fetchImpl);
      var fromMarket = text ? parseMarketplace(text) : null;
      if (fromMarket) bundles = fromMarket;
    }
    if (!bundles.length) {
      bundles = skillsInTree(paths);
    }
    if (!bundles.length) {
      return { error: 'That repository has no SKILL.md and no .claude-plugin/marketplace.json the app can install.' };
    }
    if (bundles.length > MAX_BUNDLES) {
      bundles = bundles.slice(0, MAX_BUNDLES);
    }
    for (var i = 0; i < bundles.length; i += 1) {
      bundles[i].references = referencesInTree(paths, bundles[i].dir);
    }
    return {
      owner: parsed.owner,
      repo: parsed.repo,
      ref: ref,
      rawBase: base,
      source: 'github:' + parsed.owner + '/' + parsed.repo,
      bundles: bundles,
    };
  }

  /** Raw text or null; the only other network call this module makes. */
  async function fetchText(url, fetchImpl) {
    try {
      var f = typeof fetchImpl === 'function' ? fetchImpl : fetch;
      var res = await f(url);
      if (!res.ok) return null;
      return await res.text();
    } catch {
      return null;
    }
  }

  /**
   * toEntry(bundle, found, skillMdText) — the install entry hf-skills.js
   * already understands: `repo` for the record and the error words, `path`
   * for where SKILL.md lives in the source, `rawBase` to fetch from GitHub,
   * and `files` for the references it ships (B8). Returns null when the
   * SKILL.md cannot even be parsed — the screen shows the download failing
   * instead of an entry with no name.
   */
  function toEntry(bundle, found, text) {
    if (!found || !text) return null;
    var hfSkills = (typeof module === 'object' && module.exports)
      ? require('./hf-skills.js')
      : (typeof globalThis !== 'undefined' && globalThis.FreeAI4UHfSkills) || null;
    var parsed = hfSkills ? hfSkills.parseSkillMd(text) : null;
    if (!parsed || !parsed.name) return null;
    return {
      name: parsed.name,
      description: parsed.description || '',
      content: parsed.content || '',
      files: (bundle && bundle.references) || [],
      repo: found.source,
      rawBase: found.rawBase,
      path: (bundle && bundle.dir ? bundle.dir + '/' : '') + 'SKILL.md',
      source: found.source,
      ref: found.ref || '',
    };
  }

  return {
    parseRepo: parseRepo,
    treeUrl: treeUrl,
    rawBase: rawBase,
    rawFileUrl: rawFileUrl,
    parseTree: parseTree,
    parseMarketplace: parseMarketplace,
    skillsInTree: skillsInTree,
    referencesInTree: referencesInTree,
    discover: discover,
    fetchText: fetchText,
    toEntry: toEntry,
    MAX_BUNDLES: MAX_BUNDLES,
  };
});
