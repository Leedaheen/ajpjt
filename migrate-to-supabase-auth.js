/**
 * migrate-to-supabase-auth.js
 *
 * 기존 aj_members 계정을 Supabase Auth (auth.users)에 등록하는 1회성 마이그레이션 스크립트.
 * service_role 키가 필요합니다 (Supabase 대시보드 → Settings → API → service_role).
 *
 * 사용법:
 *   node migrate-to-supabase-auth.js \
 *     --url https://xxxx.supabase.co \
 *     --service-key eyJhbGci...
 *
 * 동작:
 *   1. aj_members 테이블에서 모든 계정 조회
 *   2. auth_id 가 없는 계정마다 Supabase Auth 유저 생성 (email = empNo@aj.internal)
 *   3. aj_members.auth_id, aj_members.email 컬럼 업데이트
 *   4. 이미 auth_id 있는 계정은 건너뜀 (멱등 실행 가능)
 *
 * 주의: 비밀번호 원문이 없으므로 초기 임시 비밀번호(Aj2025!<empNo>)로 생성됩니다.
 *       마이그레이션 후 각 계정 소유자가 앱에서 비밀번호를 변경해야 합니다.
 */

const https = require('https');

// ── CLI 인자 파싱 ──────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url')          result.url = args[++i];
    if (args[i] === '--service-key')  result.serviceKey = args[++i];
    if (args[i] === '--dry-run')      result.dryRun = true;
  }
  return result;
}

// ── HTTP 요청 헬퍼 ─────────────────────────────────────────────────────────────
function request(urlStr, method, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const opts = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Supabase REST API 래퍼 ────────────────────────────────────────────────────
function sbRest(baseUrl, serviceKey, table, method = 'GET', query = '', body = null) {
  return request(
    `${baseUrl}/rest/v1/${table}${query}`,
    method,
    { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}`, 'Prefer': 'return=representation' },
    body
  );
}

// Supabase Admin Auth API
function sbAdminAuth(baseUrl, serviceKey, path, method = 'GET', body = null) {
  return request(
    `${baseUrl}/auth/v1/admin/${path}`,
    method,
    { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` },
    body
  );
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
async function main() {
  const { url, serviceKey, dryRun } = parseArgs();

  if (!url || !serviceKey) {
    console.error('사용법: node migrate-to-supabase-auth.js --url <supabase-url> --service-key <service_role_key>');
    console.error('  --dry-run  실제 변경 없이 결과만 출력');
    process.exit(1);
  }

  console.log(`\n🔍 Supabase 연결: ${url}`);
  if (dryRun) console.log('⚠️  DRY-RUN 모드 (실제 변경 없음)\n');

  // 1. aj_members 전체 조회
  const membersRes = await sbRest(url, serviceKey, 'aj_members', 'GET', '?order=created_at');
  if (membersRes.status !== 200 || !Array.isArray(membersRes.body)) {
    console.error('❌ aj_members 조회 실패:', membersRes.status, membersRes.body);
    process.exit(1);
  }

  const members = membersRes.body;
  console.log(`📋 총 ${members.length}개 계정 발견\n`);

  let created = 0, skipped = 0, failed = 0;

  for (const m of members) {
    const empNo = m.emp_no;
    const displayName = `${m.name} (${empNo})`;

    // 이미 auth_id가 있으면 건너뜀
    if (m.auth_id) {
      console.log(`  ⏭️  건너뜀 (이미 등록됨): ${displayName}`);
      skipped++;
      continue;
    }

    // email 결정: google_email 우선, 없으면 synthetic
    const email = m.google_email && m.google_email.includes('@')
      ? m.google_email
      : `${empNo.toLowerCase().replace(/[^a-z0-9]/g, '')}@aj.internal`;

    // 임시 비밀번호: Aj2025!<empNo> (마이그레이션 후 변경 필요)
    const tempPassword = `Aj2025!${empNo}`;

    console.log(`  👤 처리 중: ${displayName} → ${email}`);

    if (dryRun) {
      console.log(`     [DRY-RUN] auth user 생성 예정: email=${email}`);
      created++;
      continue;
    }

    // 2. Supabase Auth 유저 생성
    const createRes = await sbAdminAuth(url, serviceKey, 'users', 'POST', {
      email,
      password: tempPassword,
      email_confirm: true,   // 이메일 확인 불필요 (내부 계정)
      user_metadata: {
        name: m.name,
        emp_no: empNo,
        aj_type: m.aj_type || '관리자',
        phone: m.phone || '',
      },
    });

    if (createRes.status === 422 && JSON.stringify(createRes.body).includes('already been registered')) {
      // 이미 존재하는 이메일 — auth_id만 조회해서 연결
      console.log(`     ⚠️  이미 존재하는 이메일. 기존 유저와 연결 시도...`);
      const listRes = await sbAdminAuth(url, serviceKey, `users?email=${encodeURIComponent(email)}`);
      const existingUser = listRes.body?.users?.[0] || listRes.body;
      if (!existingUser?.id) {
        console.error(`     ❌ 기존 유저 조회 실패`);
        failed++;
        continue;
      }
      await _patchMember(url, serviceKey, empNo, email, existingUser.id);
      console.log(`     ✅ 연결 완료 (auth_id: ${existingUser.id})`);
      created++;
      continue;
    }

    if (createRes.status !== 200 && createRes.status !== 201) {
      console.error(`     ❌ Auth 유저 생성 실패 (${createRes.status}):`, JSON.stringify(createRes.body).slice(0, 120));
      failed++;
      continue;
    }

    const authUserId = createRes.body.id;
    console.log(`     ✅ Auth 유저 생성됨 (auth_id: ${authUserId})`);

    // 3. aj_members.auth_id, email 업데이트
    await _patchMember(url, serviceKey, empNo, email, authUserId);
    created++;
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`✅ 완료: 신규 ${created}개 | 건너뜀 ${skipped}개 | 실패 ${failed}개`);
  if (created > 0 && !dryRun) {
    console.log(`\n📌 다음 단계:`);
    console.log(`  1. Supabase 대시보드 → Authentication → Users 에서 생성된 계정 확인`);
    console.log(`  2. 각 계정 소유자에게 임시 비밀번호 Aj2025!<empNo> 전달`);
    console.log(`  3. 앱 로그인 후 비밀번호 변경 (계정 관리 화면)`);
    console.log(`  4. rls-policies.sql 을 Supabase SQL Editor에서 실행`);
  }
}

async function _patchMember(url, serviceKey, empNo, email, authId) {
  const patchRes = await sbRest(
    url, serviceKey,
    `aj_members?emp_no=eq.${encodeURIComponent(empNo)}`,
    'PATCH', '',
    { email, auth_id: authId }
  );
  if (patchRes.status >= 400) {
    console.error(`     ⚠️  aj_members 업데이트 실패 (${patchRes.status}):`, JSON.stringify(patchRes.body).slice(0, 80));
  }
}

main().catch(e => { console.error('치명적 오류:', e); process.exit(1); });
