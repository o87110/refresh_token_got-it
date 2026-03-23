# Linux 服务器部署文档

本文档基于当前项目实际实现编写，适用于将 `refresh_token_got-it` 部署到 Linux 服务器并长期运行。

---

## 1. 部署目标

部署后你将得到：

- 一个长期运行的 Node.js 服务
- 一个可访问的网页入口
- 支持运行时配置：
  - `AUTH BASE URL`
  - `OUTBOUND PROXY URL`
- 支持服务端出站代理协议：
  - `http://`
  - `https://`
  - `socks5://`
  - `socks5h://`

---

## 2. 环境要求

- Linux 服务器
- Node.js `>= 18`
- `npm`
- 建议具备：
  - `systemd`
  - `nginx`
  - 一个域名
  - HTTPS 证书

推荐系统：

- Ubuntu 22.04 / 24.04
- Debian 12

---

## 3. 项目目录建议

建议将项目放到：

```bash
/opt/refresh_token_got_it
```

例如：

```bash
sudo mkdir -p /opt/refresh_token_got_it
sudo chown -R $USER:$USER /opt/refresh_token_got_it
```

---

## 4. 安装 Node.js

如果服务器还没有合适版本的 Node.js，可以使用 NodeSource：

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

确认版本：

```bash
node -v
npm -v
```

---

## 5. 上传代码

### 方式 A：Git 拉取

```bash
cd /opt
git clone <你的仓库地址> refresh_token_got_it
cd /opt/refresh_token_got_it
```

### 方式 B：本地打包上传

将项目目录上传到服务器后进入目录：

```bash
cd /opt/refresh_token_got_it
```

---

## 6. 安装依赖

```bash
npm install
```

---

## 7. 环境变量说明

当前项目主要使用以下环境变量：

```bash
PORT=3000
OPENAI_BASE_URL=https://auth.openai.com
OUTBOUND_PROXY_URL=
OPENAI_PROXY_URL=
OPENAI_CLIENT_ID=app_EMoamEEZ73f0CkXaXp7hrann
OPENAI_REDIRECT_URI=http://localhost:1455/auth/callback
OPENAI_SCOPE="openid profile email offline_access"
```

说明：

- `PORT`
  - Node 服务监听端口
- `OPENAI_BASE_URL`
  - 默认 OpenAI OAuth 域名
  - 用于生成授权链接和兑换 token
  - 通常保持默认即可
  - 如果你有自己的 OAuth 反向代理域名，可以改成那个域名
- `OUTBOUND_PROXY_URL`
  - 服务端调用 `/oauth/token` 时使用的代理
  - 支持 `http/https/socks5/socks5h`
- `OPENAI_PROXY_URL`
  - `OUTBOUND_PROXY_URL` 的兼容别名
- `OPENAI_REDIRECT_URI`
  - 默认保留 `http://localhost:1455/auth/callback`
  - 当前项目的使用逻辑依赖这个回调形式，不建议随意修改

---

## 8. 先本地启动验证

在服务器上先直接启动一次，确认服务没问题：

```bash
cd /opt/refresh_token_got_it
PORT=3000 npm start
```

看到类似输出：

```bash
> 服务已启动: http://localhost:3000
```

然后在服务器本机执行：

```bash
curl http://127.0.0.1:3000/
```

如果返回 HTML，说明服务启动正常。

---

## 9. 使用代理启动示例

### HTTP 代理

```bash
OUTBOUND_PROXY_URL="http://127.0.0.1:7890" PORT=3000 npm start
```

### SOCKS5 代理

```bash
OUTBOUND_PROXY_URL="socks5://127.0.0.1:1080" PORT=3000 npm start
```

### SOCKS5H 代理

```bash
OUTBOUND_PROXY_URL="socks5h://127.0.0.1:1080" PORT=3000 npm start
```

---

## 10. 使用 systemd 持久化运行

建议创建专用用户：

```bash
sudo useradd -r -s /usr/sbin/nologin refresh-token
sudo chown -R refresh-token:refresh-token /opt/refresh_token_got_it
```

创建环境变量文件：

```bash
sudo mkdir -p /etc/refresh-token-got-it
sudo nano /etc/refresh-token-got-it/app.env
```

示例内容：

```bash
PORT=3000
OPENAI_BASE_URL=https://auth.openai.com
OUTBOUND_PROXY_URL=socks5h://127.0.0.1:1080
OPENAI_CLIENT_ID=app_EMoamEEZ73f0CkXaXp7hrann
OPENAI_REDIRECT_URI=http://localhost:1455/auth/callback
OPENAI_SCOPE=openid profile email offline_access
```

创建 systemd 服务文件：

```bash
sudo nano /etc/systemd/system/refresh-token-got-it.service
```

写入以下内容：

```ini
[Unit]
Description=Refresh Token Got It
After=network.target

[Service]
Type=simple
User=refresh-token
WorkingDirectory=/opt/refresh_token_got_it
EnvironmentFile=/etc/refresh-token-got-it/app.env
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

加载并启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable refresh-token-got-it
sudo systemctl start refresh-token-got-it
```

查看状态：

```bash
sudo systemctl status refresh-token-got-it
```

查看日志：

```bash
journalctl -u refresh-token-got-it -f
```

---

## 11. 使用 Nginx 反向代理

安装 Nginx：

```bash
sudo apt-get update
sudo apt-get install -y nginx
```

创建站点配置：

```bash
sudo nano /etc/nginx/sites-available/refresh-token-got-it
```

写入以下内容：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/refresh-token-got-it /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 12. HTTPS 配置

建议使用 Certbot：

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

申请成功后，通过：

```text
https://your-domain.com
```

访问页面。

---

## 13. 防火墙配置

如果使用 `ufw`：

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

如果你不走 Nginx，直接暴露 Node 端口，则需要放行对应端口，例如：

```bash
sudo ufw allow 3000/tcp
```

但更推荐使用 Nginx 反代，不建议直接公网暴露 Node 服务端口。

---

## 14. 浏览器侧和服务端代理的区别

部署到服务器后，仍然要区分两件事：

### 1. 服务端代理

由 `OUTBOUND_PROXY_URL` 控制。

它影响的是：

- 服务器调用 `/oauth/token`

### 2. 浏览器授权访问

由用户浏览器访问：

```text
AUTH BASE URL + /oauth/authorize
```

注意：

- 即使服务器能访问 OpenAI，也不代表用户浏览器能访问 OpenAI
- 如果用户浏览器无法访问 OpenAI 授权页，有两种做法：
  - 让用户自己给浏览器配置代理
  - 将页面里的 `AUTH BASE URL` 改成你自己的 OAuth 反向代理域名

---

## 15. 推荐部署方案

### 方案 A：最简单

适合：

- 服务器出网正常
- 用户浏览器也能打开 OpenAI 授权页

配置：

```bash
OPENAI_BASE_URL=https://auth.openai.com
OUTBOUND_PROXY_URL=
```

### 方案 B：服务器需要代理

适合：

- 服务器访问 OpenAI 受限
- 用户浏览器仍能直接打开 OpenAI 授权页

配置：

```bash
OPENAI_BASE_URL=https://auth.openai.com
OUTBOUND_PROXY_URL=socks5h://127.0.0.1:1080
```

### 方案 C：服务器和浏览器都受限

适合：

- 服务器访问 OpenAI 需要代理
- 用户浏览器也打不开 OpenAI 授权页

配置思路：

```bash
OPENAI_BASE_URL=https://your-oauth-proxy.example.com
OUTBOUND_PROXY_URL=socks5h://127.0.0.1:1080
```

其中：

- `OPENAI_BASE_URL` 指向你的 OAuth 反向代理域名
- `OUTBOUND_PROXY_URL` 解决服务器后端出站

---

## 16. 升级流程

如果你后续更新代码：

```bash
cd /opt/refresh_token_got_it
git pull
npm install
sudo systemctl restart refresh-token-got-it
```

---

## 17. 常见问题

### 1. 页面能打开，但提取时报 `unsupported_country_region_territory`

说明：

- 请求已经到达 OpenAI
- 但 OpenAI 识别到的服务器出口地区不被支持

处理方式：

- 检查 `OUTBOUND_PROXY_URL` 是否正确
- 更换代理节点
- 使用受支持地区的服务器

### 2. 报 `ECONNREFUSED`

说明：

- 代理地址已生效
- 但代理地址对应端口没有服务监听

处理方式：

- 检查代理软件是否启动
- 检查端口是否写错

### 3. 页面能生成链接，但浏览器打不开授权页

说明：

- 浏览器链路有问题

处理方式：

- 给浏览器配置代理
- 或使用可访问的 `AUTH BASE URL`

---

## 18. 最终建议

如果你只是想稳定上线，推荐：

1. 用 `systemd` 跑服务
2. 用 `nginx` 做反向代理
3. 用 HTTPS 域名访问
4. 如果服务器需要代理，配置 `OUTBOUND_PROXY_URL`
5. 如果用户浏览器也受限，再准备一个可用的 OAuth 反向代理域名给 `AUTH BASE URL`

这样职责清晰，运维复杂度最低。
