const express = require('express');
const path    = require('path');
const fs      = require('fs');
const app     = express();
const PORT    = process.env.PORT || 3000;

// Google Sign-In postMessage 차단 방지 (COOP 정책)
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

// 환경변수를 HTML에 주입하는 헬퍼
// Render 환경변수 SB_URL / SB_KEY / KAKAO_JS_KEY 설정 시 캐시 삭제해도 자동 복구
function _injectConfig(html){
  const cfg = `<script>window._SRV={u:${JSON.stringify(process.env.SB_URL||'')},k:${JSON.stringify(process.env.SB_KEY||'')},kk:${JSON.stringify(process.env.KAKAO_JS_KEY||'')}}</script>`;
  return html.replace('</head>', cfg + '</head>');
}

// index.html — 환경변수 주입 후 응답
const _indexPath = path.join(__dirname, 'index.html');
app.get('/', (req, res) => {
  const html = fs.readFileSync(_indexPath, 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(_injectConfig(html));
});

// 정적 파일 서빙 (JS, CSS, manifest, sw.js 등)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// SPA fallback — 모든 경로를 index.html로 (환경변수 주입 포함)
app.get('*', (req, res) => {
  const html = fs.readFileSync(_indexPath, 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(_injectConfig(html));
});

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
