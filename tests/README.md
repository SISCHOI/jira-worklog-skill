# 验证矩阵

本目录用于证明「这套技能在哪些环境里真的可用」，而不是靠口头保证。

## 快速跑

```bash
node tests/check-skill.js     # 格式合规（31 项）：文件齐全、frontmatter、跨平台约束、入口可执行
node tests/e2e.js             # 端到端（15 项）：对 mock Jira 跑完整链路，不需要真凭据
bash tests/linux-host-check.sh   # Linux：装进各宿主技能目录 + 验 Codex 是否注入 + 跑上面两项
```

`e2e.js` 会自己拉起 `tests/mock-jira.js`（127.0.0.1:8099），通过 `WL_API_BASE` + `WL_TOKEN`
指向 mock，因此**不需要 PAT、不碰真实 Jira**，可在 CI / 容器 / 无网机器上跑。

## 已验证结果（2026-11-06；2026-11-09 增加 daily --note 的 3 项）

| 维度 | 环境 | 结果 | 证据 |
|---|---|---|---|
| 功能（真实 Jira） | Windows 11 / DSH / 任一 Jira 项目 | `wl verify` **12/12 通过** | 建单→改单→子任务→分配→超限拒绝→指派人拒绝→worklog→幂等→回读→关闭→删除降级 |
| 功能（mock） | Windows 11 / node 24.19 | `e2e` **15/15**（2026-11-09） | `node tests/e2e.js`（含 --note-file / --note / 缺 --hours 不写库） |
| 功能（mock） | WSL Ubuntu 24.04 / node 24.19 | `e2e` **12/12**（2026-11-06；新增 3 项未在 WSL 重跑） | `tests/linux-host-check.sh` |
| 格式合规 | Windows / Linux | **31/31** | `node tests/check-skill.js` |
| **DSH 会话（Windows）** | dsh 0.1.5-alpha.1，headless | **技能被读取并正确使用** | `dsh --profile headless "使用 jira-worklog 技能回答：daily 需要哪些参数"` → 回答含 `--hours auto`、幂等标记、1–12h 夹取 |
| **DSH 会话（Linux）** | WSL Ubuntu 24.04，dsh 0.2.2-rc.1 | **技能被读取并正确使用** | 同一问法 → 回答含 `--issue` 必填、`--hours auto` 推断 1–12h、`[jira-worklog:day:DATE]` 幂等标记（旧 `worklog-sync` 兼容） |
| Claude Code 宿主 | Windows 2.1.251 | 任务触发时正确读到技能内容 | 提问 daily 参数，回答含 `--hours auto` 与幂等标记 |
| Codex 宿主 | Windows 0.147.0 | 注入模型输入 | `codex debug prompt-input` 含 `jira-worklog ... SKILL.md` |
| Codex 宿主 | WSL Linux 0.167.0 | 注入模型输入 | `tests/linux-host-check.sh` 的 PASS 行 |

## Linux 上跑 DSH 的两个前提（都踩过）

**1. 版本必须 ≥ 0.2.x。** npm 上的 `@deepseek-ai/dsh@0.1.5-alpha.1` 在 Linux 上插件树残缺：
它依赖的 `@deepseek-ai/dsh-sandbox-local` 在该版本没有发布到 npm（安装返回 404），启动直接
`plugin tree failed to load`。升到 `0.2.2-rc.1` 后自带插件齐全，正常启动。

**2. 需要模型凭据。** headless 会报
`MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"`。
把 `~/.dsh/.credentials.yaml` 放到 Linux 的同一路径（权限 600），启动时从里面取
`DEEPSEEK_API_KEY` 导出到环境即可（脚本里就是这么做的，不打印值）。

> 注意：不要手工往 `/opt/node/lib/node_modules/@deepseek-ai/dsh/node_modules/` 里拷插件来“修”
> 早期版本的问题——0.2.x 自带这些包，手工清理或覆盖会误删真实依赖，导致工具（bash/fs）消失。
> 正确做法是重装：`npm i -g @deepseek-ai/dsh@0.2.2-rc.1`。

## 未验证 / 边界

- **Claude Code on Linux**：WSL 未安装 CC，且 `-p` 需要登录态，未测。
- **DSH on Linux**：文件装到 `~/.dsh/skills/jira-worklog`，但 DSH 没有非交互的“列出技能”命令，
  实际注入只能在会话里观察（Windows 侧已验证）。
- **macOS**：未测。
- 真实 Jira 侧只覆盖 PROJ 项目（`DELETE_ISSUES=false` 的降级路径是实测过的）。
