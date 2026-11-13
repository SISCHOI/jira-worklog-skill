---
name: jira-worklog
description: 把"这几天干了什么"从 git 自动汇总成记录并写进 Jira：每日/每周统计、worklog（幂等，不重复计工时）、工时分配与 240h 上限守卫、建单改单关闭删除、把分支/提交/MR 链接写进工单，一条命令完成。适用于：记录工时、写 worklog、更新 jira 工时、总结这几天干了什么、周报、分配工时、把分支或提交关联到 jira、对账 original/remaining/spent、提 jira 单、建子任务、关闭或删除工单。也适用于想避开 Jira 本地化类型名、流转名不统一、timetracking 字段这些坑的场合。
---

# jira-worklog

## 为什么有它

日常要记的是**做了什么、改了哪些提交、花了多少时间**，Jira 只是落点。直接调 Jira API 会连续撞上五个坑，本工具已全部固化：

| 坑 | 现象 | 处理 |
|---|---|---|
| 类型名本地化 | `-t 子任务` / `name:"任务"` 报「选择的问题类型无效」 | 先查 `createmeta` 换成 id 再提交 |
| 流转名不统一 | 同一项目里既有 `Done` 又有 `CLOSE`/`IN PROGRESS` | 别名表 + 大小写不敏感 + 必要时两段流转 |
| 工时字段 | 只写 remaining 会把 original 一起拉低（240h→201h） | 一次同时写原估与剩余 |
| 重复计工时 | 每天跑一次多记一次；周报再记一次又翻倍 | 每日按 `[jira-worklog:day:DATE]` 幂等更新（旧 `[worklog-sync:day:...]` 兼容）；周报默认只发评论 |
| 误指派 | 顺手把人指派给别人 | 只允许指派自己，传别人直接拒绝 |

## 命令

```bash
wl create   --summary "..." [--body|--body-file] [--parent KEY] [--hours 8] [--type 任务]
wl edit     <KEY> [--summary ...] [--body-file f] [--priority High] [--labels a,b]
wl close    <KEY>          # 关闭
wl rm       <KEY>          # 删除；无删权限时降级为关闭并留痕
wl allocate <PARENT> --total 120 [--weights 1,1.5,2] [--dry-run] [--force]
wl hours    [--project PROJ] [--check]
wl daily    --issue KEY [--date D] [--hours 8|auto] [--repo .] [--note "..." | --note-file f] [--dry-run]
wl weekly   --issue KEY [--week D] [--repo .] [--dry-run] [--post-worklog --hours N]
wl link     <KEY> [--since "7 days ago"] [--mr URL]
wl verify   [--project PROJ]
```

## 关键设计

**正文优先叙述**：`daily` 的正文优先写「干了什么、完成了什么、结果如何」，用 `--note-file <f>`（推荐，多行中文更稳）或 `--note "..."` 传入；工具在正文前自动加幂等标记，正文完全替代自动摘要。不给正文时才退回 git 提交列表。提交链接是证据，放在正文末尾即可，不要只贴链接。

**每日幂等**：`daily` 用 `[jira-worklog:day:2026-11-06]` 标记查当天是否已记过；有就更新那条，没有才新增。重复跑不会把工时翻倍；改名前的 `[worklog-sync:day:...]` 仍会被识别。

**周报不重复计工时**：`weekly` 默认只把周报作为**评论**写到工单，并把 Markdown 落到 `<repo>/reports/week-START.md`。只有显式 `--post-worklog` 才写周工时；若该周已有每日 worklog 会被拒绝（`--force` 越过）。

**工时上限**：默认 240h，按项目、按"我名下的单"求和。`allocate` / `create --hours` / `estimate` 都在写之前先算"改完之后合计多少"，超上限直接拒绝。

## 时间来源

`daily` 的时长必须由人给：`--hours 8` 或 `--hours auto`（按当天提交时间跨度推断，并在评论里标注）。
不给 `--hours` 时只打印推断值，不写库——避免把机器猜测写进考核数据。

## 认证

读 `%USERPROFILE%\_netrc`（`machine/login/password=PAT`），不打印、不落盘密钥。
PAT 的获取与轮换见 `jira-cli-ops` skill。

## 安装（按宿主）

三个宿主都读本文件的 YAML frontmatter，只是目录不同；用安装脚本即可：

```bash
bash install.sh [--target=dsh|claude|codex|all]      # Linux/macOS
powershell -File install.ps1 [-Target dsh|claude|codex|all] [-AddToPath]   # Windows
```

| 宿主 | 目录 |
|---|---|
| DSH | `~/.dsh/skills/jira-worklog/`（Windows: `%USERPROFILE%\.dsh\skills\jira-worklog\`） |
| Claude Code | `~/.claude/skills/jira-worklog/` |
| Codex | `~/.codex/skills/jira-worklog/` |

不用宿主也能用：把 `scripts/` 加进 PATH 后直接 `wl …`。

Linux 上 DSH 需 ≥ 0.2.x（0.1.5-alpha.1 插件残缺启动失败）且有模型凭据；
Codex 可用 `codex debug prompt-input | grep jira-worklog` 验证加载。

## 自检

改完脚本先跑 `wl verify`：建单 → 改单 → 建子任务 → 时间分配 → 超上限被拒 → 指派他人被拒 →
写 worklog → 幂等校验 → 回读 → 归零后删除/关闭。全部通过才算可用；自检单会先归零再关，不污染预算。
