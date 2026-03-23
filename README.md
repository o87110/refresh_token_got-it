# OpenAI Refresh Token

这是一个安全、简洁的 OAuth2 Refresh Token 提取工具。
本项目采用 **服务端会话 (Server-side Session) + PKCE** 流程，确保敏感信息不暴露给前端，且最终结果已脱敏。

**本项目已针对 Zeabur 容器平台进行优化，可一键部署。**

## ⚠️ 免责声明 (Disclaimer)

> **请务必仔细阅读：**
> 1.  **仅供学习研究**：本项目仅用于学习 OAuth2 协议与 PKCE 流程，**严禁用于任何非法用途**。
> 2.  **风险自负**：使用者需自行承担使用本工具产生的所有后果（包括但不限于账号风险、数据泄露等）。
> 3.  **安全警告**：获取的 `refresh_token` 拥有您账户的完全访问权限。**切勿将 Token 发送给陌生人或发布在公开场合**。
> 4.  **无担保**：作者不对本工具的稳定性或安全性提供任何形式的担保。

---

## ☁️ Zeabur 部署指南

### 1. 准备代码
确保你已将本项目代码推送到 **GitHub** 仓库。

### 2. 创建服务
1.  登录 [Zeabur Dashboard](https://dash.zeabur.com)。
2.  创建一个新项目 (Project)。
3.  点击 **"新建服务" (New Service)** -> 选择 **"Git"**。
4.  搜索并选择你刚才上传的仓库。
5.  点击部署，Zeabur 会自动识别 Node.js 环境并开始构建。

### 3. 配置域名 (关键)
1.  等待部署成功（变成绿色）。
2.  点击该服务，进入 **"网络" (Networking)** 标签页。
3.  在 "公网访问" (Public) 部分，点击 **"生成域名"** 或 **"自定义域名"**。
4.  你会获得一个类似 `https://refresh-token-xxx.zeabur.app` 的地址。
5.  **现在，你可以通过这个地址访问你的工具了！**

> **关于端口**：Zeabur 会自动注入 `PORT` 环境变量（通常是 8080），本项目代码已自动适配，无需手动配置端口。

---

## 📖 使用教程 (必读)

由于 OpenAI 的 Client ID **强制限制**了回调地址必须为 `http://localhost:1455/auth/callback`，因此**即使你部署在 Zeabur 公网，操作流程也与本地稍有不同**：

1.  **生成链接**：
    * 访问你在 Zeabur 生成的域名（如 `https://your-app.zeabur.app`）。
    * 点击 **“生成链接”**，然后点击 **“复制”**。

2.  **浏览器授权**：
    * 在浏览器新标签页打开刚才复制的链接。
    * 登录 OpenAI 账号并确认授权。

3.  **⚠️ 关键步骤：获取回调 URL**：
    * 授权成功后，浏览器会**强制跳转**到 `http://localhost:1455/...`。
    * **此时页面可能会显示“无法访问此网站”或“连接被拒绝”。**
    * **这是完全正常的！** 因为你的电脑上并没有在 1455 端口运行服务。
    * 请直接**复制浏览器地址栏中完整的 URL**（包含 `?code=...` 的所有内容）。

4.  **提取 Token**：
    * 回到你的 **Zeabur 网页**。
    * 将刚才复制的 `localhost` 完整链接粘贴到输入框中。
    * 点击 **“获取 Token”**，即可在下方看到提取出的 Refresh Token。

---

## 💻 本地开发

如果你想在本地运行调试：

# 1. 安装依赖
```bash
npm install
```
# 2. 启动服务
```bash
npm start
```
访问地址：http://localhost:3000

## 🌐 代理配置

本项目现在支持两类网络配置：

1. **AUTH BASE URL**
   - 作用：生成浏览器授权链接时使用的 OpenAI OAuth 域名
   - 默认值：`https://auth.openai.com`
   - 用途：如果你的浏览器不能直接访问 OpenAI，可以改成你自己的 **OAuth 反向代理域名**

2. **OUTBOUND PROXY URL**
   - 作用：仅用于服务端调用 `/oauth/token` 兑换 Token
   - 支持协议：
     - `http://`
     - `https://`
     - `socks5://`
     - `socks5h://` （远程 DNS 解析）

### 环境变量

```bash
OPENAI_BASE_URL=https://auth.openai.com
OUTBOUND_PROXY_URL=
OPENAI_CLIENT_ID=app_EMoamEEZ73f0CkXaXp7hrann
OPENAI_REDIRECT_URI=http://localhost:1455/auth/callback
OPENAI_SCOPE="openid profile email offline_access"
PORT=3000
```

其中：

- `OUTBOUND_PROXY_URL` 为空时，服务端直连 OpenAI
- `OPENAI_PROXY_URL` 也可作为 `OUTBOUND_PROXY_URL` 的兼容别名

### 本地示例

HTTP 代理：

```powershell
$env:OUTBOUND_PROXY_URL="http://127.0.0.1:7890"
npm start
```

SOCKS5 代理：

```powershell
$env:OUTBOUND_PROXY_URL="socks5://127.0.0.1:1080"
npm start
```

SOCKS5H 代理（远程 DNS）：

```powershell
$env:OUTBOUND_PROXY_URL="socks5h://127.0.0.1:1080"
npm start
```

### 运行时页面配置

页面新增了两个输入框：

- `AUTH BASE URL`
- `OUTBOUND PROXY URL`

你可以直接在页面里填写并调试，无需每次重启服务。

### 浏览器代理说明

请注意：

- `OUTBOUND PROXY URL` 只影响 **服务端兑换 Token**
- 浏览器访问授权页时，**网页本身不能强制让浏览器走 HTTP / SOCKS 代理**
- 如果浏览器侧也需要代理，你有两种方式：
  1. 给浏览器或系统本身配置代理
  2. 在 `AUTH BASE URL` 中填入你自己的 OAuth 反向代理域名

### 服务器部署说明

服务器部署时同样适用：

- 如果服务器访问 OpenAI 需要代理，配置 `OUTBOUND_PROXY_URL`
- 如果最终用户浏览器无法直接访问 OpenAI，则还需要提供可访问的 `AUTH BASE URL`（OAuth 反向代理域名）

## 🔌 API 文档
1. 生成授权链接

```
Endpoint: POST /api/generate-auth-url
Body: {
  "baseUrl": "https://auth.openai.com",
  "outboundProxyUrl": "socks5h://127.0.0.1:1080"
}
Response: {
  "success": true,
  "data": {
    "authUrl": "...",
    "sessionId": "...",
    "base_url": "https://auth.openai.com",
    "outbound_proxy_url": "socks5h://127.0.0.1:1080"
  }
}
```

2. 兑换 Token

```
Endpoint: POST /api/exchange-code
Body: {
  "code": "...",
  "sessionId": "...",
  "baseUrl": "https://auth.openai.com",
  "outboundProxyUrl": "socks5h://127.0.0.1:1080"
}
Response:
{
  "success": true,
  "data": {
    "refresh_token": "...",
    "access_token": "...",
    "id_token": "...",
    "session_token": "...",
    "client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
    "expires_in": 2592000,
    "user_email": "user@...",
    "account_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    "organization_id": "org_xxx",
    "plan_type": "team",
    "base_url": "https://auth.openai.com",
    "outbound_proxy_url": "socks5h://127.0.0.1:1080"
  }
}
```
