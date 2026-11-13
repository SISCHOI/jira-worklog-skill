'use strict';
// 配置：默认值 + 可选的 ~/.jira-worklog.json 覆盖（兼容旧的 ~/.worklog-sync.json）
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // Jira 项目键，必须配置（~/.jira-worklog.json 或环境变量 JIRA_PROJECT，或命令行 --project）
  project: '',
  capHours: 240,                 // 工时上限（按项目、按我名下的单）
  capScope: 'project',           // project | week
  // 类型名按各 Jira 实例的界面语言而异（英文 Sub-task、中文「子任务」…）。
  // 留空时自动从 createmeta 里挑唯一的子任务类型；填了但匹配不到也会回退到唯一子任务类型。
  subtaskTypeName: '',
  defaultTypeName: 'Task',
  defaultPriority: 'Medium',
  gitlabHost: '',                // 留空则从 git remote 推断
  // 幂等标记前缀。改名前写进 Jira 的 [worklog-sync:...] 仍能被识别（见 legacyMarkers）
  worklogMarker: 'jira-worklog',
  legacyMarkers: ['worklog-sync'],
  reportDir: 'reports',          // 周报 Markdown 落盘目录（相对仓库根）
};

function home() {
  return process.env.USERPROFILE || process.env.HOME || '.';
}

// 新名优先；没有就读旧名，保证已有配置继续生效
function configPath() {
  const newer = path.join(home(), '.jira-worklog.json');
  if (fs.existsSync(newer)) return newer;
  const older = path.join(home(), '.worklog-sync.json');
  if (fs.existsSync(older)) return older;
  return newer;
}

function load() {
  const cfg = Object.assign({}, DEFAULTS);
  const p = configPath();
  if (fs.existsSync(p)) {
    try { Object.assign(cfg, JSON.parse(fs.readFileSync(p, 'utf8'))); } catch (_) { /* 坏了就用默认 */ }
  }
  if (process.env.JIRA_PROJECT) cfg.project = process.env.JIRA_PROJECT;
  if (process.env.JIRA_CAP_HOURS) cfg.capHours = Number(process.env.JIRA_CAP_HOURS);
  if (process.env.WL_CAP_HOURS) cfg.capHours = Number(process.env.WL_CAP_HOURS);
  return cfg;
}

// 取项目键，缺配置时给可操作的提示，而不是拿空字符串去请求
function requireProject(cfg, explicit) {
  const p = explicit || cfg.project;
  if (!p) {
    throw new Error('未配置 Jira 项目键。三种方式任选其一：\n' +
      '  1) 在 ~/.jira-worklog.json 里设置 {"project": "ABC"}\n' +
      '  2) 设置环境变量 JIRA_PROJECT=ABC\n' +
      '  3) 命令行传 --project ABC');
  }
  return p;
}

// 判定某条 worklog/评论是否由本工具写的（含改名前的标记）
function hasMarker(text, cfg, kind) {
  const t = String(text || '');
  const marks = [cfg.worklogMarker].concat(cfg.legacyMarkers || []);
  return marks.some(m => t.includes(`[${m}:${kind}:`));
}

module.exports = { load, DEFAULTS, configPath, hasMarker, requireProject };
