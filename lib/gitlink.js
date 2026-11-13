'use strict';
// git -> 提交 / 分支 / GitLab 链接
const { execFileSync } = require('child_process');

function git(repo, args) {
  return execFileSync('git', ['-C', repo].concat(args), { encoding: 'utf8' }).trim();
}

function repoInfo(repo) {
  let branch = '?', remote = '';
  try { branch = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']); } catch (_) {}
  try { remote = git(repo, ['remote', 'get-url', 'origin']); } catch (_) {}
  let web = '';
  const ssh = remote.match(/^git@([^:]+):(.+?)(\.git)?$/);
  const http = remote.match(/^(https?:\/\/[^/]+)\/(.+?)(\.git)?$/);
  if (ssh) web = `https://${ssh[1]}/${ssh[2]}`;
  else if (http) web = `${http[1]}/${http[2]}`;
  return { branch, remote, web };
}

function commits(repo, since, until) {
  const args = ['log', '--no-merges', '--pretty=format:%H\t%h\t%ad\t%s', '--date=format:%Y-%m-%d %H:%M', `--since=${since}`];
  if (until) args.push(`--until=${until}`);
  let out = '';
  try { out = git(repo, args); } catch (_) { return []; }
  return out.split('\n').filter(Boolean).map(l => {
    const [full, short, time, ...s] = l.split('\t');
    return { full, short, time, subject: s.join('\t') };
  });
}

function diffstat(repo, since, until) {
  try {
    const args = ['log', '--no-merges', `--since=${since}`];
    if (until) args.push(`--until=${until}`);
    args.push('--shortstat', '--pretty=format:');
    const lines = git(repo, args).split('\n').map(s => s.trim()).filter(Boolean);
    let files = 0, ins = 0, del = 0;
    for (const l of lines) {
      const f = l.match(/(\d+) files? changed/); if (f) files += +f[1];
      const i = l.match(/(\d+) insertions?/); if (i) ins += +i[1];
      const d = l.match(/(\d+) deletions?/); if (d) del += +d[1];
    }
    return { files, ins, del };
  } catch (_) { return null; }
}

function commitUrl(web, fullSha) {
  return web ? `${web}/-/commit/${fullSha}` : '';
}

function mrSearchUrl(web, branch) {
  return web ? `${web}/-/merge_requests?scope=all&state=all&source_branch=${encodeURIComponent(branch)}` : '';
}

module.exports = { git, repoInfo, commits, diffstat, commitUrl, mrSearchUrl };
