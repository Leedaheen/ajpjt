const express     = require('express');
const path        = require('path');
const fs          = require('fs');
const compression = require('compression');
const app         = express();
const PORT        = process.env.PORT || 3000;

// ① gzip 압축 — 모든 응답에 적용
app.use(compression());
app.use(express.json());

// Google/Kakao OAuth 팝업 postMessage 허용 (COOP 제한 해제)
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  next();
});

// 환경변수를 HTML에 주입하는 헬퍼
function _injectConfig(html){
  const cfg = `<script>window._SRV={u:${JSON.stringify(process.env.SB_URL||'')},k:${JSON.stringify(process.env.SB_KEY||'')},kk:${JSON.stringify(process.env.KAKAO_JS_KEY||'')}}</script>`;
  return html.replace('</head>', cfg + '</head>');
}

// ② index.html 캐시 — 프로덕션은 시작 시 1회, 개발은 매 요청마다 재읽기 [P2-3]
const _indexPath = path.join(__dirname, 'index.html');
const _isDev = process.env.NODE_ENV !== 'production';
const _indexHtmlProd = _isDev ? null : _injectConfig(fs.readFileSync(_indexPath, 'utf8'));

// index.html 응답 (캐시 금지 — 항상 최신 HTML)
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  // 개발 환경: 매 요청마다 파일 재읽기 (server 재시작 없이 HTML 변경 반영)
  const html = _isDev
    ? _injectConfig(fs.readFileSync(_indexPath, 'utf8'))
    : _indexHtmlProd;
  res.send(html);
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

/* ══════════════════════════════════════════════════════════
   [보안] AJ 멤버 Supabase Auth 계정 생성 API
   - 환경변수 SB_SERVICE_KEY (service_role key) 필요
   - ADMIN_SECRET 일치 여부로 요청 인가
   - 클라이언트에 service_role key 노출 없이 Supabase Auth 계정 생성
══════════════════════════════════════════════════════════ */
app.post('/api/auth/create-aj-user', async (req, res) => {
  // 요청 인가: 환경변수 ADMIN_SECRET과 헤더 일치 여부 확인
  const adminSecret = process.env.ADMIN_SECRET || '';
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
    return res.status(403).json({ error: '권한이 없습니다.' });
  }
  const sbUrl        = process.env.SB_URL || '';
  const sbServiceKey = process.env.SB_SERVICE_KEY || ''; // service_role key (서버 전용)
  if (!sbUrl || !sbServiceKey) {
    return res.status(503).json({ error: 'Supabase 서버 설정이 없습니다.' });
  }
  const { email, password, name, empNo, ajType } = req.body || {};
  if (!email || !password || !name || !empNo) {
    return res.status(400).json({ error: 'email, password, name, empNo 필드가 필요합니다.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });
  }
  try {
    // Supabase Auth Admin API — service_role key로 이메일 확인 없이 즉시 생성
    const authRes = await fetch(`${sbUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'apikey': sbServiceKey,
        'Authorization': `Bearer ${sbServiceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true, // 이메일 확인 없이 즉시 활성화
        user_metadata: { role: 'aj', aj_type: ajType || '관리자', name, emp_no: empNo }
      })
    });
    const data = await authRes.json();
    if (!authRes.ok) {
      return res.status(authRes.status).json({ error: data.message || data.error || '계정 생성 실패' });
    }
    res.json({ uid: data.id, email, message: `${name} 계정이 생성되었습니다.` });
  } catch(e) {
    res.status(500).json({ error: e.message || '서버 오류' });
  }
});

/* ══════════════════════════════════════════════════════════
   [보안] AJ 멤버 Supabase Auth 비밀번호 변경 API
══════════════════════════════════════════════════════════ */
app.post('/api/auth/update-aj-password', async (req, res) => {
  const adminSecret = process.env.ADMIN_SECRET || '';
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
    return res.status(403).json({ error: '권한이 없습니다.' });
  }
  const sbUrl        = process.env.SB_URL || '';
  const sbServiceKey = process.env.SB_SERVICE_KEY || '';
  if (!sbUrl || !sbServiceKey) {
    return res.status(503).json({ error: 'Supabase 서버 설정이 없습니다.' });
  }
  const { uid, password } = req.body || {};
  if (!uid || !password || password.length < 6) {
    return res.status(400).json({ error: 'uid와 6자 이상의 password 필드가 필요합니다.' });
  }
  try {
    const authRes = await fetch(`${sbUrl}/auth/v1/admin/users/${uid}`, {
      method: 'PUT',
      headers: {
        'apikey': sbServiceKey,
        'Authorization': `Bearer ${sbServiceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password })
    });
    const data = await authRes.json();
    if (!authRes.ok) {
      return res.status(authRes.status).json({ error: data.message || '비밀번호 변경 실패' });
    }
    res.json({ uid, message: '비밀번호가 변경되었습니다.' });
  } catch(e) {
    res.status(500).json({ error: e.message || '서버 오류' });
  }
});

/* ══════════════════════════════════════════════════════════
   [P0-1] auth_id 자동 연결 API
   Google 첫 로그인 시 aj_members.auth_id = Supabase Auth uid 로 연결.
   일반 AJ 멤버는 is_aj_admin() 미충족으로 직접 PATCH 불가 → 서버 경유
══════════════════════════════════════════════════════════ */
app.post('/api/auth/link-auth-id', async (req, res) => {
  const adminSecret = process.env.ADMIN_SECRET || '';
  if (!adminSecret || req.headers['x-admin-secret'] !== adminSecret) {
    return res.status(403).json({ error: '권한이 없습니다.' });
  }
  const sbUrl        = process.env.SB_URL || '';
  const sbServiceKey = process.env.SB_SERVICE_KEY || '';
  if (!sbUrl || !sbServiceKey) {
    return res.status(503).json({ error: 'Supabase 서버 설정이 없습니다.' });
  }
  const { empNo, authId, email } = req.body || {};
  if (!empNo || !authId) {
    return res.status(400).json({ error: 'empNo, authId 필드가 필요합니다.' });
  }
  try {
    const patchRes = await fetch(
      `${sbUrl}/rest/v1/aj_members?emp_no=eq.${encodeURIComponent(empNo)}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': sbServiceKey,
          'Authorization': `Bearer ${sbServiceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ auth_id: authId, email: email || '' })
      }
    );
    if (!patchRes.ok) {
      const err = await patchRes.text();
      return res.status(patchRes.status).json({ error: err });
    }
    res.json({ success: true, empNo, authId });
  } catch(e) {
    res.status(500).json({ error: e.message || '서버 오류' });
  }
});

// SPA fallback — 모든 경로를 index.html로
app.get('*', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  const html = _isDev
    ? _injectConfig(fs.readFileSync(_indexPath, 'utf8'))
    : _indexHtmlProd;
  res.send(html);
});

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});
