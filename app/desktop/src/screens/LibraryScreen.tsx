import { useState, useEffect, useCallback } from 'react';
import HfSignIn from '../components/HfSignIn';
import { api } from '../api';
import Icon from '../components/Icon';
import { runLocal, writeLocalFile, readLocalFile } from '../bridge';
import { renderMarkdown } from '../markdown';
import { isLinux } from '../platform';
import { pushToast } from '../components/Toasts';
import { OPEN_CHAT_EVENT, type ChatSession } from './ChatScreen';
// UMD modules: loaded for their side effect, read off globalThis.
import '../chats.js';
import '../hf-auth.js';
import '../hf-models.js';
import '../skill-lint.js';
import '../hf-skills.js';
import '../gh-skills.js';
import '../save-as-skill.js';

const hfAuth: typeof import('../hf-auth.js') = (globalThis as any).FreeAI4UHfAuth;
const hfModels: typeof import('../hf-models.js') = (globalThis as any).FreeAI4UHfModels;
const hfSkills: typeof import('../hf-skills.js') = (globalThis as any).FreeAI4UHfSkills;
const ghSkills: typeof import('../gh-skills.js') = (globalThis as any).FreeAI4UGhSkills;
const saveSkill: typeof import('../save-as-skill.js') = (globalThis as any).FreeAI4USaveAsSkill;
const skillLint: typeof import('../skill-lint.js') = (globalThis as any).FreeAI4USkillLint;

// Single-quote a path for the one shell line below (chmod). POSIX-correct for
// anything except a name containing a single quote, which safeName refuses.
function shellQuote(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

// Named for the store, not `chats`: this screen already has a `chats` state.
const chatStore: typeof import('../chats.js') = (globalThis as any).FreeAI4UChats;

interface Skill {
  source: string;
  name: string;
  description: string;
}

// The folder the local surfaces work in. App.tsx owns the state behind this
// key; the Library only ever reads it, because a skill has to land in a real
// folder and this screen is not the one that chooses which.
const LOCAL_ROOT_KEY = 'freeai4u.localRoot';

function readLocalRoot(): string {
  try {
    return localStorage.getItem(LOCAL_ROOT_KEY) || '';
  } catch {
    return '';
  }
}

// B4: a collision that stays, stays for a written reason — kept on this
// machine, never in a file the engine reads (a reason for the router would
// be a second thing the router could misread).
const REASON_KEY = 'freeai4u.skillRouting.reasons';

function readReasons(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(REASON_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function keepReasons(map: Record<string, string>): void {
  try {
    localStorage.setItem(REASON_KEY, JSON.stringify(map));
  } catch {
    /* private or full store: the reason lasts this session, the files stay */
  }
}

/** What an install is doing right now, for the one row the user clicked. */
interface InstallState {
  phase: 'working' | 'done' | 'error';
  text: string;
}

interface HfModel {
  id: string;
  author?: string;
  downloads?: number;
  likes?: number;
  tags?: string[];
  siblings?: Array<{ rfilename?: string; name?: string; size?: number }>;
  cardData?: { license?: string };
  license?: string;
  gated?: boolean | string;
}

/** Library: the engine's skill catalogue plus the chats saved on this machine. */
export default function LibraryScreen() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [open, setOpen] = useState<Skill | null>(null);
  const [content, setContent] = useState<string>('');
  const [error, setError] = useState('');
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(false);

  // --- HF Skills state ---
  const [hfCatalog, setHfCatalog] = useState<any[]>([]);
  const [hfCatalogLoading, setHfCatalogLoading] = useState(false);
  // Keyed by slug, so two rows installing at once cannot show each other's
  // progress or each other's failure.
  const [installState, setInstallState] = useState<Record<string, InstallState>>({});
  const [installed, setInstalled] = useState<import('../hf-skills.js').InstalledRecords>(
    () => hfSkills.readInstalled(),
  );
  const [localRoot] = useState<string>(readLocalRoot);

  // --- HuggingFace state ---
  const [hfSignedIn, setHfSignedIn] = useState(false);
  const [hfUser, setHfUser] = useState<any>(null);
  const [hfQuery, setHfQuery] = useState('');
  const [hfResults, setHfResults] = useState<HfModel[]>([]);
  const [hfLoading, setHfLoading] = useState(false);
  const [hfError, setHfError] = useState('');

  // --- GitHub skills (B1): paste a repository, get its bundles -----------
  const [ghInput, setGhInput] = useState('');
  const [ghBusy, setGhBusy] = useState(false);
  const [ghError, setGhError] = useState('');
  const [ghFound, setGhFound] = useState<string>('');
  const [ghCatalog, setGhCatalog] = useState<any[]>([]);

  // --- B4: routing collisions and their written reasons ------------------
  const [reasons, setReasons] = useState<Record<string, string>>(readReasons);
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({});

  // --- B12: save a chat as a skill ---------------------------------------
  const [saveState, setSaveState] = useState<Record<string, string>>({});

  // --- B9: manuals — each installed SKILL.md as a readable page ------------
  const [manual, setManual] = useState<{ name: string; text: string } | null>(null);
  const [manualQuery, setManualQuery] = useState('');

  useEffect(() => {
    const onAuth = () => setHfSignedIn(hfAuth.signedIn());
    window.addEventListener(hfAuth.AUTH_CHANGED_EVENT, onAuth);
    setHfSignedIn(hfAuth.signedIn());
    if (hfAuth.signedIn()) {
      hfAuth.fetchUser().then(u => { if (u) setHfUser(u); });
    }
  }, []);

  const hfSearch = useCallback(async () => {
    const q = hfQuery.trim();
    if (!q) return;
    setHfLoading(true);
    setHfError('');
    try {
      const headers = hfAuth.authHeaders();
      const results = await hfModels.searchModels(q, { limit: 20, authHeaders: headers });
      setHfResults(Array.isArray(results) ? results : []);
    } catch (err) {
      setHfError((err as Error).message);
    } finally {
      setHfLoading(false);
    }
  }, [hfQuery]);

  const hfSignOut = useCallback(() => {
    hfAuth.signOut();
    setHfSignedIn(false);
    setHfUser(null);
    setHfResults([]);
  }, []);

  // B1: read the repository once (its tree), then each bundle's SKILL.md —
  // the same install path as an HF skill from here on, with the same lint,
  // ceilings and running total. Nothing is fetched until Find is clicked.
  const findGitHub = useCallback(async () => {
    const input = ghInput.trim();
    if (!input || ghBusy) return;
    setGhBusy(true);
    setGhError('');
    setGhFound('');
    try {
      const found = await ghSkills.discover(input);
      if ('error' in found) {
        setGhCatalog([]);
        setGhError(found.error);
        return;
      }
      const entries: any[] = [];
      for (const bundle of found.bundles) {
        const dir = bundle.dir ? bundle.dir + '/' : '';
        const text = await ghSkills.fetchText(ghSkills.rawFileUrl(found.rawBase, dir + 'SKILL.md'));
        const entry = ghSkills.toEntry(bundle, found, text);
        if (entry) entries.push(entry);
      }
      setGhCatalog(entries);
      if (!entries.length) setGhError('The repository lists skills, but none of their SKILL.md files could be read.');
      else setGhFound(`${entries.length} skill${entries.length === 1 ? '' : 's'} from ${found.source}${found.ref ? ' @ ' + found.ref : ''}`);
    } catch (err) {
      setGhCatalog([]);
      setGhError((err as Error).message || String(err));
    } finally {
      setGhBusy(false);
    }
  }, [ghInput, ghBusy]);

  // Nothing here runs on its own: this is what the user's click on Install
  // does. The screen supplies the two things hf-skills.js refuses to invent --
  // the token (as a header, never written into a file) and a writer bound to
  // the open folder, which local.rs confines -- and hf-skills.js decides what
  // may be written and where.
  const installSkill = useCallback(async (skill: any) => {
    const slug = hfSkills.skillSlug(skill?.name || '');
    if (!slug) return;
    setInstallState((s) => ({ ...s, [slug]: { phase: 'working', text: 'Starting…' } }));
    try {
      const result = await hfSkills.installSkill(skill, {
        token: hfAuth.accessToken()?.access_token,
        writeFile: (path: string, text: string) => writeLocalFile(localRoot, path, text),
        // B7: a bundled .sh arrives executable; .ps1 files are Windows's and
        // are dropped here rather than installed beside their .sh twins.
        skipPowerShell: isLinux(),
        markExecutable: async (path: string) => {
          await runLocal({ root: localRoot, runId: 'skill-exec-bit', command: `chmod +x ${shellQuote(path)}` });
        },
        otherDescriptions: Object.values(installed)
          .filter((r: any) => r && r.name !== skill?.name)
          .map((r: any) => r.description)
          .filter(Boolean),
        onProgress: (p) => setInstallState((s) => ({
          ...s,
          [slug]: {
            phase: 'working',
            text: p.phase === 'done'
              ? 'Finishing…'
              : `${p.phase === 'fetch' ? 'Downloading' : 'Writing'} ${p.file} (${p.index + 1}/${p.total})`,
          },
        })),
      });
      setInstalled(hfSkills.rememberInstalled(skill, result));
      setInstallState((s) => ({
        ...s,
        [slug]: { phase: 'done', text: `Installed ${result.files.length} file${result.files.length === 1 ? '' : 's'} into ${result.dir}` },
      }));
    } catch (err) {
      // The whole point of the error path: say what failed, in the words
      // hf-skills.js already chose, instead of a silent no-op.
      setInstallState((s) => ({ ...s, [slug]: { phase: 'error', text: (err as Error).message } }));
    }
  }, [localRoot, installed]);

  // B12: a finished chat becomes a SKILL.md — built here, lint-gated inside
  // build(), written only when the lint passes, then recorded like any other
  // installed skill so the running total and the duplicate rule see it.
  const saveChatAsSkill = useCallback(async (c: ChatSession) => {
    if (!localRoot) { pushToast('warn', 'Open a folder first — a skill lands in the folder you are working in.'); return; }
    const built = saveSkill.build(
      { title: c.title, messages: c.messages as any },
      { others: Object.values(installed).map((r: any) => r.description).filter(Boolean) },
    );
    if ('error' in built) {
      pushToast('error', built.error);
      setSaveState((s) => ({ ...s, [c.id]: built.error }));
      return;
    }
    try {
      const dir = `${hfSkills.SKILLS_DIR}/${built.slug}`;
      const path = `${dir}/SKILL.md`;
      const text = saveSkill.render(built);
      await writeLocalFile(localRoot, path, text);
      setInstalled(hfSkills.rememberInstalled(
        { name: built.name, description: built.description, content: built.body, repo: 'chat:' + (c.title || c.id) },
        { dir, files: [path], bytes: text.length },
      ));
      const note = `Saved as ${built.slug} (${text.length} bytes)` +
        (built.warnings.length ? ` — ${built.warnings[0]}` : '');
      setSaveState((s) => ({ ...s, [c.id]: note }));
      pushToast('ok', note);
    } catch (err) {
      const why = (err as Error).message || String(err);
      setSaveState((s) => ({ ...s, [c.id]: why }));
      pushToast('error', why);
    }
  }, [localRoot, installed]);

  // B9: an installed skill's own SKILL.md, read from the open folder and
  // rendered as a page — offline, because the file is already on this disk.
  const openManual = useCallback(async (slug: string, record: { name?: string; dir?: string }) => {
    if (!localRoot) { pushToast('warn', 'Open a folder first — the manual is a file in it.'); return; }
    let dir = String(record?.dir || (hfSkills.SKILLS_DIR + '/' + slug)).trim();
    if (localRoot && dir.startsWith(localRoot)) dir = dir.slice(localRoot.length);
    dir = dir.replace(/^\/+|\/+$/g, '');
    setManual({ name: record?.name || slug, text: 'Loading…' });
    try {
      const file = await readLocalFile(localRoot, dir + '/SKILL.md');
      setManual({ name: record?.name || slug, text: file.text || '(empty SKILL.md)' });
    } catch (err) {
      setManual(null);
      pushToast('error', 'Could not read the manual: ' + ((err as Error).message || String(err)));
    }
  }, [localRoot]);

  const load = () => {
    setLoading(true);
    setError('');
    api.skills()
      .then((rows: any) => setSkills(Array.isArray(rows) ? rows : []))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    setChats(chatStore.byRecency(chatStore.readStore()) as ChatSession[]);

    // Load HF skills catalog.
    setHfCatalogLoading(true);
    const hfToken = hfAuth.accessToken()?.access_token;
    hfSkills.loadCatalog(hfToken || undefined)
      .then((rows: any) => setHfCatalog(Array.isArray(rows) ? rows : []))
      .catch(() => setHfCatalog([]))
      .finally(() => setHfCatalogLoading(false));
  };

  useEffect(() => { load(); }, []);

  const show = (s: Skill) => {
    setOpen(s);
    setContent('Loading…');
    api.skillContent(s.name)
      .then((data: any) => setContent(typeof data === 'string' ? data : data.content || data.body || JSON.stringify(data)))
      .catch((err) => setContent('Could not load: ' + (err as Error).message));
  };

  const openChat = (id: string) => window.dispatchEvent(new CustomEvent(OPEN_CHAT_EVENT, { detail: id }));

  return (
    <div className="screen library">
      <header className="screen-header">
        <h1>Library</h1>
        <div className="header-actions">
          <button onClick={load} disabled={loading} title="Re-read the engine's skills and this machine's chats">
            <Icon name="refresh" size={13} /> Refresh
          </button>
        </div>
      </header>

      {/* --- HuggingFace section --- */}
      <section className="hf-section">
        <h3 className="col-title">
          <Icon name="image" size={14} /> Hugging Face
          {hfSignedIn && hfUser && (
            <span className="hf-user"> · {hfUser.name || hfUser.fullname}
              <button className="hf-link" onClick={hfSignOut}>sign out</button>
            </span>
          )}
        </h3>
        {!hfSignedIn ? (
          <div>
            <p>Sign in to browse and download GGUF models (including gated repos).</p>
            <HfSignIn onSignedIn={(who) => { setHfSignedIn(true); setHfUser(who); }} />
          </div>
        ) : (
          <div className="hf-browser">
            <div className="hf-search-bar">
              <input
                value={hfQuery}
                onChange={(e) => setHfQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') hfSearch(); }}
                placeholder="Search GGUF models (e.g. Qwen3-Coder, Llama-3, Unsloth)"
              />
              <button onClick={hfSearch} disabled={hfLoading || !hfQuery.trim()}>
                {hfLoading ? 'Searching…' : 'Search'}
              </button>
            </div>
            {hfError && <div className="stream-error">{hfError}</div>}
            <div className="hf-results">
              {hfResults.map((m) => {
                const ggufCount = (m.siblings || []).filter((s: any) => /\.gguf$/i.test(s.rfilename || s.name || '')).length;
                const gated = hfModels.isGated(m);
                return (
                  <div key={m.id} className="hf-model-card">
                    <div className="hf-model-header">
                      <span className="hf-model-name">{m.id}</span>
                      {gated && <span className="hf-badge gated">gated</span>}
                      {ggufCount > 0 && <span className="hf-badge gguf">{ggufCount} GGUF</span>}
                    </div>
                    <div className="hf-model-meta">
                      {m.downloads != null && <span>{(m.downloads || 0).toLocaleString()} downloads</span>}
                      {m.likes != null && <span>{m.likes} likes</span>}
                      {hfModels.licenseShort(m) && <span>{hfModels.licenseShort(m)}</span>}
                    </div>
                    {ggufCount > 0 && (
                      <div className="hf-model-files">
                        {hfModels.ggufFiles(m).slice(0, 5).map((f: any) => (
                          <div key={f.name} className="hf-file">
                            <span className="hf-file-name">{f.name}</span>
                            <span className="hf-file-meta">{f.quant} · {hfModels.formatSize(f.size)}{f.fitsRam ? ` · fits ${f.fitsRam}` : ''}</span>
                          </div>
                        ))}
                        {ggufCount > 5 && <div className="hf-file more">…and {ggufCount - 5} more</div>}
                      </div>
                    )}
                  </div>
                );
              })}
              {hfResults.length === 0 && !hfLoading && !hfError && (
                <div className="empty">Search for GGUF models to see available quants and sizes.</div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* B9: the manuals — every installed SKILL.md as a readable page,
          searchable without the network because the files are already on
          this disk. The records are the Library's own (hf-skills.js); the
          text comes from the open folder when a manual is opened. */}
      <section className="library-installed">
        <h3 className="col-title"><Icon name="check" size={14} /> Installed manuals ({Object.keys(installed).length})</h3>
        {(() => {
          const rows = Object.entries(installed)
            .filter(([, r]: [string, any]) => r && r.name)
            .filter(([, r]: [string, any]) => {
              const q = manualQuery.trim().toLowerCase();
              if (!q) return true;
              return (String(r.name) + ' ' + String(r.description || '')).toLowerCase().includes(q);
            })
            .sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)));
          return (
            <>
              <div className="gh-install">
                <input
                  value={manualQuery}
                  onChange={(e) => setManualQuery(e.target.value)}
                  placeholder="Search the installed skills — offline, this folder only"
                  aria-label="Search installed skills"
                />
              </div>
              {!Object.keys(installed).length && (
                <div className="empty">Nothing installed in this folder yet — install from the catalogue above, or save a chat as a skill.</div>
              )}
              {!!Object.keys(installed).length && !rows.length && (
                <div className="empty">No installed skill matches “{manualQuery}”.</div>
              )}
              <div className="skill-list">
                {rows.map(([slug, r]: [string, any]) => (
                  <div key={slug} className="installed-row">
                    <div className="skill-name">{r.name}</div>
                    <div className="skill-desc">{r.description}</div>
                    {skillLint.negative(r.description) ? (
                      <div className="skill-neg">{skillLint.negative(r.description)}</div>
                    ) : null}
                    <div className="skill-src" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button onClick={() => void openManual(slug, r)} title="Read this skill's SKILL.md as a page">
                        <Icon name="library" size={12} /> Manual
                      </button>
                      <span>{r.repo || 'local'}{r.dir ? ' · ' + r.dir : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          );
        })()}
      </section>

      <div className="library-layout">
        <section className="library-col">
          <h3 className="col-title">Skills ({hfCatalog.length + ghCatalog.length})</h3>
          <div className="gh-install">
            <input
              value={ghInput}
              onChange={(e) => setGhInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void findGitHub(); }}
              placeholder="Install from GitHub — a URL or owner/repo with SKILL.md files"
              aria-label="A GitHub repository from which to install skills"
              disabled={ghBusy}
            />
            <button onClick={() => void findGitHub()} disabled={ghBusy || !ghInput.trim()}>
              {ghBusy ? 'Reading…' : 'Find skills'}
            </button>
          </div>
          {ghError && <div className="stream-error">{ghError}</div>}
          {ghFound && <div className="skill-src">{ghFound}</div>}
          {(() => {
            // B2's running total: the installed skills' names and descriptions
            // are in every prompt, and there is a point past which that is too
            // much. A note, not a wall: the budget is skillLint.TOKEN_BUDGET.
            const total = skillLint.catalogCost(
              Object.values(installed).map((r: any) => ({ name: r.name, description: r.description })),
            );
            return total.count > 0 ? (
              <div className="skill-src">
                {total.count} installed skill{total.count === 1 ? '' : 's'} cost about {total.tokens} tokens of every prompt
                {total.over ? ` — over the ${total.budget} budget; disable one or the router gets noisy` : ` (budget ${total.budget})`}
              </div>
            ) : null;
          })()}
          {(() => {
            // B4: two skills sharing two or more triggers compete on every
            // prompt. The pair is flagged; keeping both is allowed, but only
            // with a written reason on this machine.
            const rows = Object.values(installed)
              .filter((r: any) => r && r.name && r.description)
              .map((r: any) => ({ name: String(r.name), description: String(r.description) }));
            const collisions = skillLint.lintRouting(rows);
            if (!collisions.length) return null;
            return (
              <div className="skill-routing">
                {collisions.map((c) => {
                  const key = skillLint.pairKey(c.a, c.b);
                  const reason = reasons[key] || '';
                  const draft = reasonDraft[key] ?? reason;
                  return (
                    <div className="skill-warn" key={key}>
                      <div>
                        <strong>{c.a}</strong> and <strong>{c.b}</strong> both claim{' '}
                        {c.shared.map((w: string) => `“${w}”`).join(', ')} — on every prompt the router
                        cannot tell them apart. Re-word one description to narrow it, or remove one folder.
                      </div>
                      <div className="skill-reason">
                        <input
                          value={draft}
                          onChange={(e) => setReasonDraft((d) => ({ ...d, [key]: e.target.value }))}
                          placeholder="Why keep both? (a written reason)"
                          aria-label={`Why keep ${c.a} and ${c.b}`}
                        />
                        <button
                          onClick={() => {
                            const next = { ...reasons };
                            if (draft.trim()) next[key] = draft.trim();
                            else delete next[key];
                            setReasons(next);
                            keepReasons(next);
                          }}
                          disabled={draft.trim() === reason}
                        >
                          {reason ? 'Update' : 'Save reason'}
                        </button>
                      </div>
                      {reason && <div className="skill-src">Keeping both: {reason}</div>}
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {hfCatalogLoading && <div className="empty">Loading HF skills…</div>}
          <div className="skill-list">
            {[...hfCatalog, ...ghCatalog].map((s: any) => {
              const slug = hfSkills.skillSlug(s.name || '');
              const state = installState[slug];
              const status = hfSkills.installStatus(s, installed);
              const busy = state?.phase === 'working';
              const record = installed[slug];
              // B2/B3: what this skill costs every prompt, and whether it is
              // worth installing at all. Errors block the button.
              const cost = skillLint.contextCost(s);
              const lint = skillLint.lintSkill({
                name: s.name,
                folderName: slug,
                description: s.description,
                body: s.content,
                files: ['SKILL.md'].concat(Array.isArray(s.files) ? s.files : []),
              });
              const blocked = lint.errors.length > 0;
              const prereqs = skillLint.prereqTools(s.content || '');
              return (
                <div key={`${s.repo || 'hf'}|${s.name}`} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <button className={`skill-item ${open?.name === s.name ? 'active' : ''}`} onClick={() => { setOpen({ name: s.name, description: s.description, source: s.repo || 'hf' }); setContent(s.content); }}>
                    <div className="skill-name">
                      {s.name}
                      {status !== 'install' && (
                        <span className="hf-badge"> {status === 'update' ? 'update available' : 'installed'}</span>
                      )}
                    </div>
                    <div className="skill-desc">{s.description}</div>
                    {(() => {
                      // B5: the description's own "Do not use when…", shown
                      // where the install decision is made. Display only —
                      // honouring it in routing is the engine's call (upstream).
                      const neg = skillLint.negative(s.description);
                      return neg ? <div className="skill-neg">{neg}</div> : null;
                    })()}
                    <div className="skill-src">{s.repo}{s.tags?.length ? ' · ' + s.tags.join(', ') : ''}</div>
                  </button>
                  <div className="skill-src" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => installSkill(s)}
                      disabled={busy || !localRoot || blocked}
                      title={blocked
                        ? `This skill does not pass the lint: ${lint.errors[0]}`
                        : localRoot
                          ? `Write this skill into ${hfSkills.SKILLS_DIR}/${slug} in the open folder. Costs about ${cost.tokens} tokens of context on every prompt.`
                          : 'Open a folder first — a skill installs into the folder you are working in'}
                    >
                      <Icon name="download" size={12} />{' '}
                      {busy ? 'Installing…' : status === 'update' ? 'Update' : status === 'installed' ? 'Reinstall' : 'Install'}
                    </button>
                    <span title={`Its name and description ride in every prompt: about ${cost.tokens} tokens.`}>~{cost.tokens} tok</span>
                    {!localRoot && <span>Open a folder to install</span>}
                    {localRoot && state?.phase === 'working' && <span>{state.text}</span>}
                    {localRoot && state?.phase === 'done' && <span>{state.text}</span>}
                    {localRoot && !state && record?.dir && <span>{record.dir}</span>}
                  </div>
                  {blocked && <div className="stream-error">Not installable: {lint.errors.join('; ')}</div>}
                  {!blocked && lint.warnings.map((w: string) => <div key={w} className="skill-src">{w}</div>)}
                  {prereqs.length > 0 && (
                    <div className="skill-src" title={prereqs.map((t: string) => skillLint.toolFix(t) || t).join('\n')}>
                      Needs: {prereqs.join(', ')}
                    </div>
                  )}
                  {state?.phase === 'error' && <div className="stream-error">{state.text}</div>}
                </div>
              );
            })}
            {!hfCatalog.length && !ghCatalog.length && !hfCatalogLoading && <div className="empty">No skills loaded yet — sign in to Hugging Face, or paste a GitHub repository above.</div>}
          </div>
        </section>

        <section className="library-col">
          <h3 className="col-title">Skills on this engine ({skills.length})</h3>
          {error && <div className="stream-error">{error}</div>}
          <div className="skill-list">
            {skills.map((s) => (
              <button key={s.source + '/' + s.name} className={`skill-item ${open?.name === s.name ? 'active' : ''}`} onClick={() => show(s)}>
                <div className="skill-name">{s.name}</div>
                <div className="skill-desc">{s.description}</div>
                <div className="skill-src">{s.source}</div>
              </button>
            ))}
            {!skills.length && !loading && <div className="empty">No skills reported yet — refresh once the engine is reachable.</div>}
          </div>
        </section>

        <section className="library-col">
          {manual ? (
            <>
              <h3 className="col-title">
                {manual.name} · manual
                <button className="hf-link" onClick={() => setManual(null)}>close</button>
              </h3>
              <div
                className="skill-manual"
                // B9: the file is on this disk and renderMarkdown escapes
                // every character before any tag is emitted (markdown.ts).
                dangerouslySetInnerHTML={{ __html: renderMarkdown(manual.text) }}
              />
            </>
          ) : open ? (
            <>
              <h3 className="col-title">{open.name}</h3>
              <pre className="skill-content">{content}</pre>
            </>
          ) : (
            <>
              <h3 className="col-title">Chats on this machine ({chats.length})</h3>
              <div className="skill-list">
                {chats.map((c) => (
                  <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button className="skill-item" onClick={() => openChat(c.id)}>
                      <div className="skill-name">{c.title || 'Untitled'}</div>
                      <div className="skill-src">{c.messages.length} messages · {new Date(c.updatedAt).toLocaleString()}</div>
                    </button>
                    <div className="skill-src" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={() => void saveChatAsSkill(c)}
                        title="Turn this chat into a SKILL.md in .neuraos/skills — the same lint gates it as an install"
                      >
                        <Icon name="download" size={12} /> Save as skill
                      </button>
                      {saveState[c.id] && <span>{saveState[c.id]}</span>}
                      {!localRoot && <span>Open a folder to save</span>}
                    </div>
                  </div>
                ))}
                {!chats.length && <div className="empty">Chats you start appear here, saved on this device only.</div>}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
