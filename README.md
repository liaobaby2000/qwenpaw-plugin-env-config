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
| `opencode-setup` | 安装 opencode | 从 GitHub 下载最新版，配置 LLM API Key |

## 内置方案

| ID | 名称 | 包含脚本 |
|---|---|---|
| `minimal` | 最小配置 | apt-tsinghua → sshd-setup |
| `full-dev` | 完整开发环境 | apt-tsinghua → sshd-setup → proxychains-setup → opencode-setup |

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
