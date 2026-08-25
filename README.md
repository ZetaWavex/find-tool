# Find Phone Tool - Cloudflare 中继服务器

通过 Cloudflare Workers + KV 实现子域名中继，让多台手机互相查找。

## 架构

```
手机A (查找) → POST /notify → Cloudflare Worker → KV 存储
                                                    ↑
手机B (轮询) ← GET /pending  ← Cloudflare Worker ← 读取命令
手机B 执行响铃/震动 → POST /ack → 清除命令
```

## 部署步骤

### 1. 安装 Wrangler CLI

```bash
npm install -g wrangler
wrangler login
```

### 2. 创建 KV 命名空间

```bash
cd server
npm install
npm run kv:create
```

输出示例：
```
[[kv_namespaces]]
binding = "KV"
id = "abc123..."  ← 复制这个 id
```

### 3. 更新 wrangler.toml

将上一步得到的 KV id 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "KV"
id = "abc123..."  ← 替换
```

同时修改 `AUTH_TOKEN` 为你的自定义密码（用于 Dashboard API 鉴权）。

### 4. 本地测试

```bash
npm run dev
```

访问 `http://localhost:8787` 查看 Dashboard。

### 5. 手动部署

```bash
npm run deploy
```

部署后会得到 `https://find-phone-relay.<your-subdomain>.workers.dev`。

### 6. GitHub 自动部署（可选）

1. Fork 本仓库到 GitHub
2. 在 GitHub 仓库 → Settings → Secrets 添加：
   - `CLOUDFLARE_API_TOKEN` — Cloudflare API Token（Dashboard → My Profile → API Tokens → Create）
   - `CLOUDFLARE_ACCOUNT_ID` — Cloudflare Account ID（Dashboard 右侧栏）
3. 推送到 main 分支即可自动部署

### 7. 绑定自定义域名（可选）

在 Cloudflare Dashboard → Workers → 你的 Worker → Triggers → Custom Domains 添加域名。

## API 接口

### POST /notify
存储查找命令到 KV。
```json
{ "target": "my-phone", "action": "find", "duration": 30 }
```

### GET /pending?phone=my-phone
返回待执行命令。
```json
{ "action": "find", "duration": 30, "timestamp": 1692888000000 }
```

### POST /ack
确认命令已执行，从 KV 删除。
```json
{ "phone": "my-phone" }
```

### GET /
Web Dashboard 控制面板。

### GET /api/phones
列出所有待执行命令（需 Bearer Token）。

### POST /api/clear
清除指定手机命令（需 Bearer Token）。
```json
{ "phone": "my-phone" }
```

## 手机端配置

在 Android 应用的「设置」页面：
1. 子域名地址填入 Worker URL（如 `https://find-phone-relay.xxx.workers.dev`）
2. 本机名称填入唯一标识（如 `my-phone`）
3. 开启监听

在另一台手机点「查找」，输入目标手机名称即可。
