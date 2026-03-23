const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

// [保持原样] 端口恢复为 3000
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// [保持原样] 这里的端口是 1455，用于骗过 OpenAI 的白名单
const DEFAULT_OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

const OPENAI_CONFIG = {
  BASE_URL: process.env.OPENAI_BASE_URL || 'https://auth.openai.com',
  CLIENT_ID: process.env.OPENAI_CLIENT_ID || DEFAULT_OPENAI_CLIENT_ID,
  REDIRECT_URI: process.env.OPENAI_REDIRECT_URI || 'http://localhost:1455/auth/callback',
  SCOPE: process.env.OPENAI_SCOPE || 'openid profile email offline_access',
  OUTBOUND_PROXY_URL: process.env.OUTBOUND_PROXY_URL || process.env.OPENAI_PROXY_URL || ''
};

const OAUTH_SESSIONS = new Map();
const SESSION_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;
const PROXY_AGENT_CACHE = new Map();
const SUPPORTED_PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks5h:']);
let proxyAgentConstructorPromise = null;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } 
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sid, session] of OAUTH_SESSIONS) {
    if (session.expiresAt <= now) OAUTH_SESSIONS.delete(sid);
  }
}

function generateOpenAIPKCE() {
  const codeVerifier = crypto.randomBytes(64).toString('hex');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function normalizeOpenAIBaseUrl(value) {
  const candidate = String(value || '').trim() || OPENAI_CONFIG.BASE_URL;
  let parsed;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('授权域名无效，请输入完整的 http(s):// 地址');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('授权域名只支持 http:// 或 https://');
  }

  return trimTrailingSlash(parsed.toString());
}

function normalizeProxyUrl(value) {
  const candidate = String(value || '').trim() || OPENAI_CONFIG.OUTBOUND_PROXY_URL;
  if (!candidate) return '';

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('代理地址无效，请输入完整的代理 URL');
  }

  if (!SUPPORTED_PROXY_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('代理协议只支持 HTTP、HTTPS、SOCKS5 和 SOCKS5H');
  }

  return parsed.toString();
}

async function getProxyAgent(proxyUrl) {
  if (!proxyUrl) return undefined;
  if (!proxyAgentConstructorPromise) {
    proxyAgentConstructorPromise = import('proxy-agent').then(module => module.ProxyAgent);
  }
  if (!PROXY_AGENT_CACHE.has(proxyUrl)) {
    const ProxyAgent = await proxyAgentConstructorPromise;
    PROXY_AGENT_CACHE.set(proxyUrl, new ProxyAgent({
      getProxyForUrl: () => proxyUrl
    }));
  }

  return PROXY_AGENT_CACHE.get(proxyUrl);
}

function resolveOpenAIRequestConfig(overrides = {}) {
  return {
    baseUrl: normalizeOpenAIBaseUrl(overrides.baseUrl),
    outboundProxyUrl: normalizeProxyUrl(overrides.outboundProxyUrl),
    clientId: resolveClientId(overrides.clientId)
  };
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid ID token');
  const payload = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
  return JSON.parse(payload);
}

function safeDecodeJwtPayload(token) {
  try {
    return decodeJwtPayload(token);
  } catch {
    return null;
  }
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return '';
}

function extractOpenAIAccountInfo(tokenData) {
  const accessPayload = safeDecodeJwtPayload(tokenData.access_token) || {};
  const idPayload = safeDecodeJwtPayload(tokenData.id_token) || {};
  const accessAuth = accessPayload['https://api.openai.com/auth'] || {};
  const idAuth = idPayload['https://api.openai.com/auth'] || {};
  const accessProfile = accessPayload['https://api.openai.com/profile'] || {};
  const organizations = Array.isArray(idAuth.organizations) ? idAuth.organizations : [];
  const defaultOrganization = organizations.find(item => item && item.is_default) || organizations[0] || null;

  return {
    userEmail: pickFirstNonEmpty(
      idPayload.email,
      accessProfile.email
    ),
    accountId: pickFirstNonEmpty(
      accessAuth.chatgpt_account_id,
      idAuth.chatgpt_account_id
    ),
    userId: pickFirstNonEmpty(
      accessAuth.chatgpt_user_id,
      idAuth.chatgpt_user_id,
      accessAuth.user_id,
      idAuth.user_id
    ),
    organizationId: pickFirstNonEmpty(defaultOrganization && defaultOrganization.id),
    planType: pickFirstNonEmpty(
      accessAuth.chatgpt_plan_type,
      idAuth.chatgpt_plan_type
    ),
    accessTokenExpiresAt: pickFirstNonEmpty(accessPayload.exp, 0),
    sessionToken: String(tokenData.id_token || '')
  };
}


function resolveClientId(clientIdFromRequest) {
  const candidate = String(clientIdFromRequest || '').trim();
  if (candidate) return candidate;
  return OPENAI_CONFIG.CLIENT_ID;
}

async function requestText(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    body = '',
    proxyUrl = '',
    timeoutMs = REQUEST_TIMEOUT_MS
  } = options;

  const agent = await getProxyAgent(proxyUrl);

  return new Promise((resolve, reject) => {
    const targetUrl = new URL(url);
    const client = targetUrl.protocol === 'https:' ? https : http;
    const req = client.request({
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || undefined,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method,
      headers,
      agent
    }, res => {
      let rawText = '';
      res.setEncoding('utf8');
      res.on('data', chunk => rawText += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          headers: res.headers,
          text: rawText
        });
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('上游请求超时'));
    });

    req.on('error', reject);

    if (body) req.write(body);
    req.end();
  });
}

function parseJsonResponse(response) {
  const rawText = response.text;
  if (!rawText) return {};

  try {
    return JSON.parse(rawText);
  } catch {
    const snippet = rawText.slice(0, 200).replace(/\s+/g, ' ').trim();
    throw new Error(`上游返回了非 JSON 响应（HTTP ${response.status}）：${snippet}`);
  }
}

// 路由处理
async function handleGenerateAuthUrl(req, res) {
  try {
    cleanupExpiredSessions();
    const pkce = generateOpenAIPKCE();
    const state = crypto.randomBytes(32).toString('hex');
    const sessionId = crypto.randomUUID();

    const { clientId, baseUrl, outboundProxyUrl } = await readJsonBody(req);
    const requestConfig = resolveOpenAIRequestConfig({ clientId, baseUrl, outboundProxyUrl });

    OAUTH_SESSIONS.set(sessionId, {
      codeVerifier: pkce.codeVerifier,
      state,
      clientId: requestConfig.clientId,
      baseUrl: requestConfig.baseUrl,
      outboundProxyUrl: requestConfig.outboundProxyUrl,
      expiresAt: Date.now() + SESSION_TTL_MS
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: requestConfig.clientId,
      redirect_uri: OPENAI_CONFIG.REDIRECT_URI,
      scope: OPENAI_CONFIG.SCOPE,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: 'S256',
      state,
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true'
    });

    return sendJson(res, 200, {
      success: true,
      data: {
        authUrl: `${requestConfig.baseUrl}/oauth/authorize?${params.toString()}`,
        sessionId,
        base_url: requestConfig.baseUrl,
        outbound_proxy_url: requestConfig.outboundProxyUrl
      }
    });
  } catch (err) {
    return sendJson(res, 500, { success: false, message: err.message });
  }
}

async function handleExchangeCode(req, res) {
  try {
    const { code, sessionId, clientId, baseUrl, outboundProxyUrl } = await readJsonBody(req);
    const session = OAUTH_SESSIONS.get(String(sessionId));

    if (!session) return sendJson(res, 400, { success: false, message: '会话无效或已过期' });

    const requestConfig = resolveOpenAIRequestConfig({
      clientId: clientId || session.clientId,
      baseUrl: baseUrl || session.baseUrl,
      outboundProxyUrl: outboundProxyUrl || session.outboundProxyUrl
    });
    const requestBody = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: OPENAI_CONFIG.REDIRECT_URI,
      client_id: requestConfig.clientId,
      code_verifier: session.codeVerifier
    }).toString();

    const tokenRes = await requestText(`${requestConfig.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(requestBody)
      },
      body: requestBody,
      proxyUrl: requestConfig.outboundProxyUrl
    });

    const tokenData = parseJsonResponse(tokenRes);
    if (tokenRes.status < 200 || tokenRes.status >= 300) {
      const statusCode = tokenRes.status === 429 ? 429 : 400;
      const message = tokenRes.status === 429
        ? 'OpenAI 限流（429）。请稍后重试，或使用你自己的 OPENAI_CLIENT_ID / 代理后再试。'
        : 'OpenAI error';
      return sendJson(res, statusCode, { success: false, message, error: tokenData });
    }

    const accountInfo = extractOpenAIAccountInfo(tokenData);
    OAUTH_SESSIONS.delete(String(sessionId));

    return sendJson(res, 200, {
      success: true,
      data: {
        refresh_token: tokenData.refresh_token,
        access_token: tokenData.access_token,
        id_token: tokenData.id_token,
        session_token: accountInfo.sessionToken,
        expires_in: tokenData.expires_in,
        access_token_expires_at: accountInfo.accessTokenExpiresAt,
        client_id: requestConfig.clientId,
        user_email: accountInfo.userEmail,
        account_id: accountInfo.accountId,
        user_id: accountInfo.userId,
        organization_id: accountInfo.organizationId,
        plan_type: accountInfo.planType,
        base_url: requestConfig.baseUrl,
        outbound_proxy_url: requestConfig.outboundProxyUrl
      }
    });
  } catch (err) {
    return sendJson(res, 500, { success: false, message: err.message });
  }
}

// 静态文件服务
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/generate-auth-url') return handleGenerateAuthUrl(req, res);
  if (req.method === 'POST' && req.url === '/api/exchange-code') return handleExchangeCode(req, res);
  
  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
  if (!path.normalize(filePath).startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });

  fs.readFile(filePath, (err, content) => {
    if (err) return sendJson(res, 404, { error: 'Not Found' });
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`\n> 服务已启动: http://localhost:${PORT}\n`);
});
