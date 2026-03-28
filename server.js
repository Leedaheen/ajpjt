const express     = require('express');
const path        = require('path');
const fs          = require('fs');
const compression = require('compression');
const app         = express();
const PORT        = process.env.PORT || 3000;

// ① gzip 압축 — 모든 응답에 적용
app.use(compression());

// Google Sign-In postMessage 차단 방지 (COOP 정책)
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

// 환경변수를 HTML에 주입하는 헬퍼
function _injectConfig(html){
  const cfg = `<script>window._SRV={u:${JSON.stringify(process.env.SB_URL||'')},k:${JSON.stringify(process.env.SB_KEY||'')},kk:${JSON.stringify(process.env.KAKAO_JS_KEY||'')}}</script>`;
  return html.replace('</head>', cfg + '</head>');
}

// ② index.html 메모리 캐시 — 서버 시작 시 한 번만 읽고 주입
const _indexPath = path.join(__dirname, 'index.html');
const _indexHtml = _injectConfig(fs.readFileSync(_indexPath, 'utf8'));

// index.html 응답 (캐시 금지 — 항상 최신 HTML)
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.send(_indexHtml);
});

// ③ sw.js — 서비스워커는 항상 최신 버전 확인 (캐시 금지)
app.get('/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

// ③ JS 파일 — 1년 캐시 (재방문 시 다운로드 없음)
app.use('/js', express.static(path.join(__dirname, 'js'), {
  maxAge: '1y',
  immutable: true,
}));

// 나머지 정적 파일 (manifest, icons 등)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// SPA fallback — 모든 경로를 index.html로 (메모리 캐시 사용)
app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.send(_indexHtml);
});

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
