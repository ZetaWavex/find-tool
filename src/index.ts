/**
 * Find Phone Tool - Cloudflare Worker 中继服务器
 *
 * API:
 *   POST /notify    { target, action, duration }   → 存储查找命令
 *   GET  /pending?phone=xxx                        → 返回待执行命令
 *   POST /ack       { phone }                      → 确认命令已执行
 *   GET  /api/phones                               → 列出所有待执行手机
 *   POST /api/clear { phone }                       → 清除指定手机命令
 *   GET  /                                         → Web Dashboard
 */
export interface Env {
  KV: KVNamespace;
  AUTH_TOKEN: string;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    // CORS
    if (method === 'OPTIONS') {
      return corsResponse(new Response(null, { status: 204 }));
    }
    try {
      // ===== API 路由 =====
      // POST /notify — 存储查找命令
      if (path === '/notify' && method === 'POST') {
        return await handleNotify(request, env);
      }
      // GET /pending?phone=xxx — 查询待执行命令
      if (path === '/pending' && method === 'GET') {
        return await handlePending(url, env);
      }
      // POST /ack — 确认命令已执行
      if (path === '/ack' && method === 'POST') {
        return await handleAck(request, env);
      }
      // ===== Dashboard API =====
      // GET /api/phones — 列出所有待执行手机
      if (path === '/api/phones' && method === 'GET') {
        return await handleListPhones(request, env);
      }
      // POST /api/clear — 清除指定手机命令
      if (path === '/api/clear' && method === 'POST') {
        return await handleClear(request, env);
      }
      // POST /api/clear-all — 清除所有命令
      if (path === '/api/clear-all' && method === 'POST') {
        return await handleClearAll(request, env);
      }
      // ===== Web Dashboard =====
      if (path === '/' && method === 'GET') {
        return new Response(DASHBOARD_HTML, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
      // 404
      return corsResponse(new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }));
    } catch (e) {
      return corsResponse(new Response(JSON.stringify({ error: 'Internal Server Error', message: String(e) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }));
    }
  },
};
// ===== 处理函数 =====
async function handleNotify(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ target: string; action: string; duration?: number }>();
  if (!body.target || !body.action) {
    return corsResponse(jsonResponse({ success: false, error: '缺少 target 或 action' }, 400));
  }
  const key = `pending:${body.target}`;
  const command = {
    target: body.target,
    action: body.action,
    duration: body.duration || 30,
    timestamp: Date.now(),
  };
  await env.KV.put(key, JSON.stringify(command), { expirationTtl: 300 });
  // 同时存入手机列表用于 Dashboard
  await env.KV.put(`phone:${body.target}`, String(Date.now()), { expirationTtl: 600 });
  return corsResponse(jsonResponse({ success: true, message: `已通知 ${body.target}` }));
}
async function handlePending(url: URL, env: Env): Promise<Response> {
  const phone = url.searchParams.get('phone');
  if (!phone) {
    return corsResponse(jsonResponse({ error: '缺少 phone 参数' }, 400));
  }
  const key = `pending:${phone}`;
  const data = await env.KV.get(key);
  if (data) {
    const command = JSON.parse(data);
    return corsResponse(jsonResponse(command));
  }
  return corsResponse(jsonResponse({ action: '' }));
}
async function handleAck(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ phone: string }>();
  if (!body.phone) {
    return corsResponse(jsonResponse({ success: false, error: '缺少 phone' }, 400));
  }
  await env.KV.delete(`pending:${body.phone}`);
  return corsResponse(jsonResponse({ success: true }));
}
async function handleListPhones(request: Request, env: Env): Promise<Response> {
  const authError = checkAuth(request, env);
  if (authError) return authError;
  const list = await env.KV.list({ prefix: 'pending:' });
  const phones = [];
  for (const item of list.keys) {
    const data = await env.KV.get(item.name);
    if (data) {
      const cmd = JSON.parse(data);
      phones.push({
        name: item.name.replace('pending:', ''),
        action: cmd.action,
        duration: cmd.duration,
        timestamp: cmd.timestamp,
        ago: Math.round((Date.now() - cmd.timestamp) / 1000),
      });
    }
  }
  return corsResponse(jsonResponse({ phones }));
}
async function handleClear(request: Request, env: Env): Promise<Response> {
  const authError = checkAuth(request, env);
  if (authError) return authError;
  const body = await request.json<{ phone: string }>();
  if (!body.phone) {
    return corsResponse(jsonResponse({ success: false, error: '缺少 phone' }, 400));
  }
  await env.KV.delete(`pending:${body.phone}`);
  await env.KV.delete(`phone:${body.phone}`);
  return corsResponse(jsonResponse({ success: true }));
}
async function handleClearAll(request: Request, env: Env): Promise<Response> {
  const authError = checkAuth(request, env);
  if (authError) return authError;
  const list = await env.KV.list({ prefix: 'pending:' });
  for (const item of list.keys) {
    await env.KV.delete(item.name);
  }
  const phoneList = await env.KV.list({ prefix: 'phone:' });
  for (const item of phoneList.keys) {
    await env.KV.delete(item.name);
  }
  return corsResponse(jsonResponse({ success: true, cleared: list.keys.length }));
}
// ===== 工具函数 =====
function checkAuth(request: Request, env: Env): Response | null {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token || token !== env.AUTH_TOKEN) {
    return corsResponse(jsonResponse({ error: '未授权' }, 401));
  }
  return null;
}
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function corsResponse(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(res.body, { status: res.status, headers });
}
// ===== Dashboard HTML =====
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Find Phone Tool - 控制面板</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: linear-gradient(135deg, #667eea, #764ba2); min-height: 100vh; color: #333; }
.container { max-width: 600px; margin: 0 auto; padding: 20px; }
.card { background: #fff; border-radius: 16px; padding: 24px; margin-bottom: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
h1 { color: #667eea; font-size: 24px; margin-bottom: 4px; }
.subtitle { color: #888; font-size: 14px; margin-bottom: 20px; }
input, select { width: 100%; padding: 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; margin-bottom: 12px; outline: none; transition: border 0.2s; }
input:focus, select:focus { border-color: #667eea; }
label { display: block; font-size: 13px; color: #555; margin-bottom: 4px; font-weight: 500; }
.btn { width: 100%; padding: 14px; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; transition: transform 0.1s; }
.btn:active { transform: scale(0.98); }
.btn-green { background: #27ae60; color: #fff; }
.btn-blue { background: #667eea; color: #fff; }
.btn-red { background: #e74c3c; color: #fff; }
.btn-gray { background: #95a5a6; color: #fff; }
.row { display: flex; gap: 8px; }
.row > * { flex: 1; }
.phone-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #eee; }
.phone-item:last-child { border: none; }
.phone-name { font-weight: bold; font-size: 15px; }
.phone-action { font-size: 13px; color: #667eea; }
.phone-time { font-size: 12px; color: #aaa; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; }
.badge-find { background: #e8f5e9; color: #27ae60; }
.badge-ring { background: #fff3cd; color: #856404; }
.badge-vibrate { background: #d1ecf1; color: #0c5460; }
.empty { text-align: center; color: #aaa; padding: 20px; }
.toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #333; color: #fff; padding: 12px 24px; border-radius: 8px; font-size: 14px; z-index: 999; display: none; }
.chip { display: inline-block; padding: 6px 12px; border-radius: 16px; font-size: 13px; cursor: pointer; margin-right: 6px; margin-bottom: 6px; border: 2px solid #e0e0e0; }
.chip.active { background: #667eea; color: #fff; border-color: #667eea; }
.section-title { font-size: 16px; font-weight: bold; margin-bottom: 12px; color: #333; }
</style>
</head>
<body>
<div class="container">
  <div class="card">
    <h1>Find Phone Tool</h1>
    <div class="subtitle">通过子域名中继查找手机</div>
    <div class="section-title">发送查找通知</div>
    <label>目标手机名称</label>
    <input type="text" id="targetPhone" placeholder="如: my-phone">
    <label>操作类型</label>
    <div style="margin-bottom:12px">
      <span class="chip active" data-action="find" onclick="selectAction(this)">一键查找</span>
      <span class="chip" data-action="ring" onclick="selectAction(this)">响铃</span>
      <span class="chip" data-action="vibrate" onclick="selectAction(this)">震动</span>
    </div>
    <label>持续时间（秒）</label>
    <input type="number" id="duration" value="30" min="5" max="120">
    <button class="btn btn-green" onclick="sendNotify()">发送通知</button>
  </div>
  <div class="card">
    <div class="section-title">待执行命令</div>
    <div id="phoneList"><div class="empty">加载中...</div></div>
    <button class="btn btn-red" style="margin-top:12px" onclick="clearAll()">清除所有命令</button>
  </div>
  <div class="card">
    <div class="section-title">设置</div>
    <label>管理 Token（用于 Dashboard API）</label>
    <input type="password" id="authToken" placeholder="输入管理 Token">
    <button class="btn btn-blue" onclick="saveToken()">保存 Token</button>
    <div style="margin-top:8px">
      <button class="btn btn-gray" onclick="refreshList()">刷新列表</button>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
let selectedAction = 'find';
let token = localStorage.getItem('fp_token') || '';
function selectAction(el) {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  selectedAction = el.dataset.action;
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 2000);
}
async function sendNotify() {
  const target = document.getElementById('targetPhone').value.trim();
  const duration = parseInt(document.getElementById('duration').value) || 30;
  if (!target) { showToast('请输入目标手机名称'); return; }
  const res = await fetch('/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target, action: selectedAction, duration })
  });
  const data = await res.json();
  if (data.success) { showToast(data.message); refreshList(); }
  else { showToast(data.error || '发送失败'); }
}
async function refreshList() {
  if (!token) { document.getElementById('phoneList').innerHTML = '<div class="empty">请先保存 Token</div>'; return; }
  const res = await fetch('/api/phones', { headers: { 'Authorization': 'Bearer ' + token } });
  if (res.status === 401) { document.getElementById('phoneList').innerHTML = '<div class="empty">Token 无效</div>'; return; }
  const data = await res.json();
  const list = document.getElementById('phoneList');
  if (!data.phones || data.phones.length === 0) {
    list.innerHTML = '<div class="empty">暂无待执行命令</div>';
    return;
  }
  list.innerHTML = data.phones.map(p => {
    const badgeClass = 'badge badge-' + p.action;
    const timeStr = p.ago < 60 ? p.ago + '秒前' : Math.floor(p.ago/60) + '分钟前';
    return '<div class="phone-item"><div><div class="phone-name">' + p.name + '</div><div class="phone-time">' + timeStr + '</div></div><div style="text-align:right"><span class="' + badgeClass + '">' + p.action + ' / ' + p.duration + 's</span><br><button style="margin-top:4px;padding:4px 8px;font-size:12px;border:1px solid #e74c3c;background:#fff;color:#e74c3c;border-radius:4px;cursor:pointer" onclick="clearPhone(\\'' + p.name + '\\')">清除</button></div></div>';
  }).join('');
}
async function clearPhone(name) {
  await fetch('/api/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ phone: name })
  });
  showToast('已清除 ' + name);
  refreshList();
}
async function clearAll() {
  if (!token) { showToast('请先保存 Token'); return; }
  await fetch('/api/clear-all', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token }
  });
  showToast('已清除所有命令');
  refreshList();
}
function saveToken() {
  token = document.getElementById('authToken').value.trim();
  localStorage.setItem('fp_token', token);
  showToast('Token 已保存');
  refreshList();
}
// 自动加载
if (token) document.getElementById('authToken').value = token;
refreshList();
setInterval(refreshList, 10000);
</script>
</body>
</html>`;
