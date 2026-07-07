# Environment Config Plugin for QwenPaw

一键环境配置插件 — 通过管理 shell/python 脚本和配置方案，快速配置 Docker QwenPaw 环境，可用于docker部署方式下升级后的快速恢复原来的环境。
适用场景举例：QwenPaw升级频繁，采用docker compose部署，平时的需求包括通过sshd访问QwenPaw镜像内部及进行一些国内源等，提前映射好22端口，当镜像更新后运行一下配置方案或脚本即可，有什么其他需要的可以自己新建脚本。

## 功能

- **📜 配置脚本管理**：浏览、创建、编辑、删除配置脚本（Shell / Python）
- **📋 配置方案管理**：将多个脚本组合成方案，一键顺序执行
- **⚡ 流式执行**：SSE 实时输出执行日志，支持参数传递
- **📦 内置脚本**：开箱即用，覆盖常见配置场景
- **🔐 持久化存储**：用户数据保存在 `/app/working/plugins/env-config-userdata/`，Docker 重启后随 `/app/working/plugins` 持久化

## 内置脚本

| ID | 名称 | 描述 |
|---|---|---|
| `apt-tsinghua` | 更换清华 apt 源 | 面向 Debian 12（bookworm），写入 `/etc/apt/sources.list.d/debian.sources` |
| `sshd-setup` | 安装并配置 SSH 服务 | 设置 root 密码、公私钥认证，并通过 supervisord 实现容器重启后自动启动 |
| `proxychains-setup` | 安装 proxychains | 配置 socks4/socks5/http 代理，支持用户名和密码参数 |
| `rdp-desktop-setup` | 安装并配置 RDP 桌面 | 复用容器内现有 Xvfb/xfce4，通过 xrdp/x11vnc 暴露 3389，支持 mstsc 实时查看桌面 |
| `browser-desktop-launch` | 在 RDP 桌面启动浏览器窗口 | 在现有 Xvfb 桌面中启动 Chromium，便于通过 RDP 手动登录或处理验证码 |
| `trae-ide-setup` | 安装并配置 Trae IDE | 安装 Trae IDE 桌面客户端，并配置 localmodel 与 Volcano Engine Coding Plan 两个大模型 |
| `vscode-setup` | 安装并配置 VS Code | 安装 VS Code 桌面客户端，并配置 localmodel 与 Volcano Engine Coding Plan 两个大模型 |
| `opencode-setup` | 安装 opencode | 从 GitHub 下载最新版，配置 LLM API Key |
| `qwen-code-setup` | 安装并配置 Qwen Code ACP Agent | 安装 `qwen`，写入 `qwen_code` ACP runner，可配置 OpenAI-compatible API Key、base URL 和模型 |
| `claude-code-setup` | 安装并配置 Claude Agent ACP | 安装 `claude-agent-acp`，写入 `claude_code` ACP runner，可配置 `ANTHROPIC_API_KEY` |
| `codex-setup` | 安装并配置 Codex ACP Agent | 安装 `codex-acp`，写入 `codex` ACP runner，可配置 `OPENAI_API_KEY` |
| `dockercli` | 安装并配置 dockercli | 安装docker-cli和docker compose，不安装docker，qwenpaw容器通过-v /var/run/docker.sock:/var/run/docker.sock挂载到宿主机，对docker进行使用。 |
| `git` | 配置git | git config --global user.email git config --global user.name |

## 内置方案

| ID | 名称 | 包含脚本 |
|---|---|---|
| `minimal` | 最小配置 | apt-tsinghua → sshd-setup |
| `full-dev` | 完整开发环境 | apt-tsinghua → sshd-setup → proxychains-setup → opencode-setup |

## ACP Agent 配置说明

`qwen-code-setup`、`claude-code-setup`、`codex-setup` 会默认修改当前 workspace 的 `agent.json`：

- 在 `acp.agents` 下写入对应 runner：`qwen_code`、`claude_code`、`codex`
- 默认启用 `tools.agent.delegate_external_agent`，之后可通过内置工具 `delegate_external_agent` 调用外部 ACP runner
- 默认备份原配置为 `agent.json.bak.YYYYmmddHHMMSS`
- 如果只安装 CLI、不修改 QwenPaw 配置，可将 `patch_qwenpaw_config` 设为 `false`

API Key 会写入 runner 的 `env`（Claude/Codex）或 Qwen Code 的 `~/.qwen/settings.json`（Qwen Code）。执行脚本时不要把真实密钥粘贴到公开日志或聊天中。

## 快速开始

### 安装

```bash
# 从开发目录安装
cd qwenpaw-plugin-env-config
echo "y" | qwenpaw plugin install .
```

### 热重载

```bash
bash hot-reload.sh
```

## API 端点

| 方法 | 路径 | 描述 |
|---|---|---|
| GET | `/api/env-config/scripts` | 列出所有脚本 |
| GET | `/api/env-config/scripts/{id}` | 获取脚本详情 |
| POST | `/api/env-config/scripts` | 创建用户脚本 |
| PUT | `/api/env-config/scripts/{id}` | 更新用户脚本 |
| DELETE | `/api/env-config/scripts/{id}` | 删除用户脚本 |
| GET | `/api/env-config/schemes` | 列出所有方案 |
| GET | `/api/env-config/schemes/{id}` | 获取方案详情 |
| POST | `/api/env-config/schemes` | 创建方案 |
| PUT | `/api/env-config/schemes/{id}` | 更新方案 |
| DELETE | `/api/env-config/schemes/{id}` | 删除方案 |
| POST | `/api/env-config/execute` | 执行脚本或方案（SSE 流） |

## 数据存储

- **用户脚本**：`/app/working/plugins/env-config-userdata/scripts/{id}.json`
- **方案**：`/app/working/plugins/env-config-userdata/schemes/{id}.json`
- **内置脚本**：`<plugin-dir>/data/scripts/*.json`

## 开发

```bash
# 构建前端
cd frontend
NODE_PATH=/path/to/node_modules npx vite build
```
