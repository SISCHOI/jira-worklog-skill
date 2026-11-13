'use strict';
// 技能格式合规检查：DSH / Claude Code / Codex 三家都要求 SKILL.md + YAML frontmatter(name, description)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REQUIRED = ['SKILL.md', 'README.md', 'lib/netrc.js', 'lib/jira.js', 'lib/gitlink.js', 'lib/report.js',
  'lib/config.js', 'commands/create.js', 'commands/edit.js', 'commands/allocate.js', 'commands/close.js',
  'commands/daily.js', 'commands/weekly.js', 'commands/hours.js', 'commands/link.js', 'commands/verify.js',
  'scripts/wl.js', 'scripts/wl.cmd', 'install.ps1', 'install.sh', 'config.example.json'];

function parseFrontmatter(txt) {
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const mm = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (mm) out[mm[1]] = mm[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const checks = [];
const add = (name, ok, detail) => checks.push([name, ok, detail]);

// 1. 必需文件
for (const f of REQUIRED) {
  add(`文件存在 ${f}`, fs.existsSync(path.join(ROOT, f)), '');
}

// 2. frontmatter
const skillTxt = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
const fm = parseFrontmatter(skillTxt);
add('frontmatter 存在', !!fm, fm ? '' : '缺少 --- 包裹的 YAML');
if (fm) {
  add('frontmatter.name 存在', !!fm.name, fm.name);
  add('frontmatter.description 存在', !!fm.description, (fm.description || '').slice(0, 40) + '…');
  // 仓库目录可以叫别的名字，但安装脚本必须把它落到 <技能名>/ 下（CC/Codex/DSH 都按目录名识别）
  {
    const dirName = path.basename(ROOT);
    const installPs = fs.readFileSync(path.join(ROOT, 'install.ps1'), 'utf8');
    const installSh = fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8');
    const psMaps = installPs.includes(fm.name) && /skills/i.test(installPs);
    const shMaps = installSh.includes(fm.name) && /skills/i.test(installSh);
    add('name 与安装目录一致', dirName === fm.name ? true : (psMaps && shMaps),
      dirName === fm.name ? dirName : `仓库目录=${dirName}，安装脚本用 ${fm.name} 建 skills/ 子目录 ${(psMaps && shMaps) ? '✓' : '✗'}`);
  }
  add('name 为 kebab-case', /^[a-z0-9]+(-[a-z0-9]+)*$/.test(fm.name || ''), fm.name);
  add('description 长度合理(<=1024)', (fm.description || '').length <= 1024, String((fm.description || '').length));
  add('description 含触发词', /worklog|工时|jira/i.test(fm.description || ''), '');
}

// 3. 跨平台：脚本里不应出现写死的盘符/反斜杠路径
const jsFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) jsFiles.push(p);
  }
})(ROOT);
let hardCoded = [];
for (const f of jsFiles) {
  const t = fs.readFileSync(f, 'utf8');
  if (/["'][A-Za-z]:\\\\/.test(t) || /C:\\\\Users/.test(t)) hardCoded.push(path.relative(ROOT, f));
}
add('无写死的 Windows 路径', hardCoded.length === 0, hardCoded.join(','));
add('使用 USERPROFILE||HOME 兼容双平台', /USERPROFILE\s*\|\|\s*process\.env\.HOME/.test(fs.readFileSync(path.join(ROOT, 'lib/netrc.js'), 'utf8')), '');

// 4. 入口可在当前平台执行
try {
  const { execFileSync } = require('child_process');
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/wl.js'), 'help'], { encoding: 'utf8' });
  add(`入口可执行 (${process.platform})`, /create/.test(out), '');
} catch (e) {
  add(`入口可执行 (${process.platform})`, false, e.message);
}

const bad = checks.filter(c => !c[1]).length;
console.log(`=== 技能格式检查 (${process.platform}, node ${process.version}) ===`);
for (const [n, ok, d] of checks) console.log(`${ok ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`);
console.log(bad ? `\n${bad} 项失败` : `\n全部 ${checks.length} 项通过`);
process.exitCode = bad ? 1 : 0;
