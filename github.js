// S GitHub: quản lý repo trên tài khoản GitHub (liệt kê, tạo, public/private, lưu trữ, xóa, tải ZIP).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

module.exports = function init({ WS, cfg, json, body }) {
  const API = process.env.SHUB_GH_API || 'https://api.github.com';
  const DL = path.join(WS, 'downloads', 'ma-nguon');
  let tokenCache = { at: 0, v: '' };
  const getToken = () => {
    if (cfg.githubToken) return cfg.githubToken;
    if (Date.now() - tokenCache.at < 60000) return tokenCache.v;
    const r = spawnSync('gh auth token', { shell: true, encoding: 'utf8', timeout: 5000 });
    tokenCache = { at: Date.now(), v: r.status === 0 ? r.stdout.trim() : '' };
    return tokenCache.v;
  };
  const bad = (m, status = 400) => { const e = new Error(m); e.status = status; throw e; };
  async function gh(method, p, data, extra = {}) {
    const t = getToken(); if (!t) bad('Chưa có token GitHub. Điền githubToken trong config.json hoặc chạy gh auth login.', 401);
    const r = await fetch(API + p, { method, redirect: extra.raw ? 'manual' : 'follow', headers: { Authorization: `Bearer ${t}`, Accept: 'application/vnd.github+json', 'User-Agent': 's-hub', 'X-GitHub-Api-Version': '2022-11-28', ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
    if (extra.raw) return r;
    let j = null; const txt = await r.text(); try { j = txt ? JSON.parse(txt) : null; } catch {}
    if (!r.ok) {
      const msg = (j && j.message) || r.statusText;
      const hint = r.status === 401 ? ' (token sai hoặc hết hạn)' : r.status === 403 ? ' (token thiếu quyền, cần scope "repo"; xóa repo cần thêm "delete_repo")' : r.status === 404 ? ' (không thấy, hoặc token không có quyền)' : r.status === 422 ? ' ' + JSON.stringify((j && j.errors) || '') : '';
      bad(`GitHub: ${msg}${hint}`, r.status === 422 ? 400 : r.status);
    }
    return { data: j, headers: r.headers };
  }
  const norm = (x) => ({ name: x.name, full: x.full_name, owner: x.owner && x.owner.login, private: !!x.private, desc: x.description || '', lang: x.language || '', stars: x.stargazers_count, forks: x.forks_count, issues: x.open_issues_count, size: x.size, pushed: x.pushed_at, created: x.created_at, archived: !!x.archived, fork: !!x.fork, url: x.html_url, clone: x.clone_url, ssh: x.ssh_url, branch: x.default_branch, topics: x.topics || [], license: x.license && x.license.spdx_id });
  let cache = { at: 0, list: null };
  async function listAll(force) {
    if (!force && cache.list && Date.now() - cache.at < 60000) return cache.list;
    const out = [];
    for (let p = 1; p <= 10; p++) {
      const { data } = await gh('GET', `/user/repos?per_page=100&page=${p}&sort=pushed&affiliation=owner,collaborator,organization_member`);
      out.push(...data.map(norm)); if (data.length < 100) break;
    }
    cache = { at: Date.now(), list: out }; return out;
  }
  const FULL = /^[\w-]{1,39}\/[\w.-]{1,100}$/;
  const needFull = (f) => { if (!FULL.test(String(f || ''))) bad('Tên repo không hợp lệ'); return f; };

  return async function handle(req, res, u) {
    if (!u.pathname.startsWith('/api/gh/')) return false;
    try {
      const route = u.pathname.slice(8);
      if (route === 'me') {
        if (!getToken()) return json(res, 200, { ok: false, error: 'Chưa có token GitHub. Điền githubToken trong config.json (scope: repo, delete_repo nếu muốn xóa) hoặc chạy gh auth login.' }), true;
        const { data, headers } = await gh('GET', '/user');
        let orgs = []; try { orgs = (await gh('GET', '/user/orgs?per_page=50')).data.map((o) => o.login); } catch {}
        return json(res, 200, { ok: true, login: data.login, name: data.name, avatar: data.avatar_url, scopes: headers.get('x-oauth-scopes') || '', orgs }), true;
      }
      if (route === 'repos') { const list = await listAll(u.searchParams.get('refresh') === '1'); return json(res, 200, { ok: true, repos: list }), true; }
      const b = req.method === 'POST' ? await body(req) : {};
      if (route === 'create') {
        const name = String(b.name || '');
        if (!/^[\w.-]{1,100}$/.test(name)) bad('Tên repo chỉ gồm chữ, số, dấu chấm, gạch ngang, gạch dưới');
        const org = b.org ? String(b.org) : '';
        if (org && !/^[\w-]{1,39}$/.test(org)) bad('Tên tổ chức không hợp lệ');
        const payload = { name, description: String(b.description || '').slice(0, 350), private: b.private !== false, auto_init: !!b.autoInit };
        if (b.gitignore) { if (!/^[\w+.# -]{1,50}$/.test(b.gitignore)) bad('Mẫu .gitignore không hợp lệ'); payload.gitignore_template = b.gitignore; }
        if (b.license) { if (!/^[\w.-]{1,40}$/.test(b.license)) bad('Giấy phép không hợp lệ'); payload.license_template = b.license; }
        const { data } = await gh('POST', org ? `/orgs/${org}/repos` : '/user/repos', payload);
        cache.at = 0; return json(res, 200, { ok: true, repo: norm(data) }), true;
      }
      if (route === 'update') {
        const full = needFull(b.full); const patch = {};
        if (b.description !== undefined) patch.description = String(b.description).slice(0, 350);
        if (b.archived !== undefined) patch.archived = !!b.archived;
        if (b.private !== undefined) {
          patch.private = !!b.private;
          // Chuyển sang public làm lộ mã nguồn: bắt buộc gõ lại đúng tên repo
          if (!b.private && b.confirmName !== full.split('/')[1]) bad('Để chuyển sang Public, hãy gõ đúng tên repo để xác nhận');
        }
        const { data } = await gh('PATCH', `/repos/${full}`, patch);
        cache.at = 0; return json(res, 200, { ok: true, repo: norm(data) }), true;
      }
      if (route === 'delete') {
        const full = needFull(b.full);
        if (b.confirmName !== full) bad('Hãy gõ đúng tên đầy đủ (owner/repo) để xác nhận xóa');
        await gh('DELETE', `/repos/${full}`); cache.at = 0; return json(res, 200, { ok: true }), true;
      }
      if (route === 'detail') {
        const full = needFull(u.searchParams.get('full'));
        const [info, langs, commits, branches] = await Promise.all([
          gh('GET', `/repos/${full}`), gh('GET', `/repos/${full}/languages`).catch(() => ({ data: {} })),
          gh('GET', `/repos/${full}/commits?per_page=8`).catch(() => ({ data: [] })), gh('GET', `/repos/${full}/branches?per_page=30`).catch(() => ({ data: [] })),
        ]);
        return json(res, 200, { ok: true, repo: norm(info.data), languages: langs.data, branches: branches.data.map((x) => x.name),
          commits: commits.data.map((c) => ({ sha: c.sha.slice(0, 7), msg: (c.commit.message || '').split('\n')[0].slice(0, 120), author: (c.commit.author && c.commit.author.name) || '', date: c.commit.author && c.commit.author.date })) }), true;
      }
      if (route === 'download') {
        const full = needFull(b.full); const ref = b.ref ? String(b.ref) : '';
        if (ref && !/^[\w.\/-]{1,100}$/.test(ref)) bad('Tên nhánh/tag không hợp lệ');
        const r = await gh('GET', `/repos/${full}/zipball${ref ? '/' + ref : ''}`, null, { raw: true });
        const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
        const fin = loc ? await fetch(loc) : r; if (!fin.ok) bad('Không tải được: HTTP ' + fin.status, fin.status);
        fs.mkdirSync(DL, { recursive: true });
        const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        const fname = `${full.split('/')[1]}-${(ref || 'default').replace(/\//g, '_')}-${ts}.zip`;
        const dest = path.join(DL, fname);
        const buf = Buffer.from(await fin.arrayBuffer()); fs.writeFileSync(dest + '.part', buf); fs.renameSync(dest + '.part', dest);
        return json(res, 200, { ok: true, file: fname, bytes: buf.length, category: 'ma-nguon' }), true;
      }
      return json(res, 404, { error: 'not found' }), true;
    } catch (e) { json(res, e.status && e.status >= 400 && e.status < 600 ? e.status : 500, { ok: false, error: String(e.message || e) }); return true; }
  };
};
