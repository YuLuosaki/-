// 通过 git 的 curl 凭据链无法调 API，改用 node http 走 CONNECT 代理
const http = require('http');
const crypto = require('crypto');

const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = 62386;
const auth = 'Basic ' + Buffer.from('1061820624@qq.com:Zhiyuan1227').toString('base64');

function httpsViaProxy(method, host, path, body, headers) {
  return new Promise((resolve, reject) => {
    const key = Buffer.from(host + ':443').toString('base64');
    const req = http.request({
      host: PROXY_HOST, port: PROXY_PORT,
      method: 'CONNECT',
      path: host + ':443',
      headers: { 'Host': host + ':443', 'Proxy-Authorization': 'Basic ' + key }
    });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error('CONNECT ' + res.statusCode));
      }
      const tls = require('tls');
      const secure = tls.connect({
        socket, servername: host, rejectUnauthorized: false
      }, () => {
        const payload = body ? JSON.stringify(body) : null;
        const h = Object.assign({
          'User-Agent': 'workbuddy', 'Authorization': auth,
          'Accept': 'application/vnd.github+json',
          'Host': host
        }, headers || {});
        if (payload) {
          h['Content-Type'] = 'application/json';
          h['Content-Length'] = Buffer.byteLength(payload);
        }
        const r2 = secure.request({
          host, method, path, headers: h,
          rejectUnauthorized: false
        }, r => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => { secure.end(); resolve({ code: r.statusCode, body: d }); });
        });
        r2.on('error', e => { secure.end(); reject(e); });
        if (payload) r2.write(payload);
        r2.end();
      });
      secure.on('error', e => { socket.destroy(); reject(e); });
    });
    req.on('error', reject);
    req.setTimeout(40000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

(async () => {
  try {
    const r = await httpsViaProxy('GET', 'api.github.com', '/user', null);
    console.log('=== /user → ' + r.code + ' ===');
    if (r.code !== 200) { console.log(r.body.slice(0, 500)); return; }
    const j = JSON.parse(r.body);
    console.log('login: ' + j.login);
    console.log('name: ' + j.name);
    console.log('public_repos: ' + j.public_repos);
    console.log('bio: ' + (j.bio || '(空)'));

    const repo = process.argv[2] || 'history-figure-test';
    const desc = process.argv[3] || '你像哪个历史人物 · 纯本地 H5 人格测试（16题/六维模型/六位历史人物原型）';

    const c = await httpsViaProxy('POST', 'api.github.com', '/user/repos', {
      name: repo, description: desc, private: false,
      auto_init: false, has_issues: true, has_wiki: false
    });
    console.log('\n=== 创建仓库 → ' + c.code + ' ===');
    if (c.code === 201) {
      const cj = JSON.parse(c.body);
      console.log('成功: ' + cj.full_name);
      console.log('地址: ' + cj.html_url);
      console.log('克隆: ' + cj.clone_url);
    } else {
      console.log(c.body.slice(0, 600));
    }
  } catch (e) {
    console.log('异常: ' + e.message);
  }
})();
