const express = require('express');
const path    = require('path');
const app     = express();
const PORT    = process.env.PORT || 3000;

// Google Sign-In postMessage 차단 방지 (COOP 정책)
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, 'public')));

// PWA manifest, sw.js
app.use(express.static(__dirname));

// SPA fallback — 모든 경로를 index.html로
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
