// pdfrotate 검증 하니스 — node verify.mjs
// index.html의 CORE 구간(순수 로직)을 추출해 Node에서 실행하고,
// 정적 HTML 계약(필수 요소·접근성 규칙)을 함께 점검한다.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok', name); }
  else { fail++; console.error('  FAIL', name); }
}
function section(title) { console.log('\n' + title); }

// ===== CORE 추출·실행 =====
const m = html.match(/\/\/ ===== CORE-START[\s\S]*?\/\/ ===== CORE-END/);
if (!m) { console.error('CORE 구간을 찾지 못했습니다'); process.exit(1); }
const context = {};
vm.createContext(context);
vm.runInContext(m[0].replace(/^\/\/ ===== CORE-START.*$/m, '').replace(/^\/\/ ===== CORE-END.*$/m, ''), context);
// const/let 바인딩은 컨텍스트 프로퍼티로 노출되지 않으므로 수집 표현식으로 가져온다
const C = vm.runInContext(`({
  normalizeAngle, nextRotation, resultFileName, hasPdfHeader, classifyOpenFailure,
  OPEN_FAILURE_MESSAGES,
  springStep: typeof springStep === 'function' ? springStep : undefined,
  project: typeof project === 'function' ? project : undefined,
  snapDetent: typeof snapDetent === 'function' ? snapDetent : undefined,
  shortestDeg: typeof shortestDeg === 'function' ? shortestDeg : undefined,
  classifyDrag: typeof classifyDrag === 'function' ? classifyDrag : undefined,
  releaseDetent: typeof releaseDetent === 'function' ? releaseDetent : undefined,
})`, context);

// ===== 각도 정규화 · 상대 회전 =====
section('normalizeAngle / nextRotation');
check('0 → 0', C.normalizeAngle(0) === 0);
check('360 → 0', C.normalizeAngle(360) === 0);
check('-90 → 270', C.normalizeAngle(-90) === 270);
check('450 → 90', C.normalizeAngle(450) === 90);
check('-450 → 270', C.normalizeAngle(-450) === 270);
check('90 + 90 → 180', C.nextRotation(90, 90) === 180);
check('270 + 90 → 0', C.nextRotation(270, 90) === 0);
check('0 + 270 → 270 (반시계 90°)', C.nextRotation(0, 270) === 270);
check('180 + 270 → 90', C.nextRotation(180, 270) === 90);

// ===== 결과 파일명 =====
section('resultFileName');
check('기본: scan.pdf + 270', C.resultFileName('scan.pdf', 270) === 'scan-rotated-270.pdf');
check('확장자 대문자: SCAN.PDF', C.resultFileName('SCAN.PDF', 90) === 'SCAN-rotated-90.pdf');
check('확장자 없음', C.resultFileName('scan', 90) === 'scan-rotated-90.pdf');
check('재회전 시 접미사 중첩 방지', C.resultFileName('doc-rotated-180.pdf', 90) === 'doc-rotated-90.pdf');
check('중간의 유사 패턴은 보존', C.resultFileName('doc-rotated-180-final.pdf', 90) === 'doc-rotated-180-final-rotated-90.pdf');
check('비정준 각도 접미사는 벗기지 않음', C.resultFileName('doc-rotated-45.pdf', 90) === 'doc-rotated-45-rotated-90.pdf');

// ===== PDF 헤더 탐지 =====
section('hasPdfHeader');
const enc = (s) => new TextEncoder().encode(s);
check('선두 %PDF-', C.hasPdfHeader(enc('%PDF-1.4\n...')) === true);
check('1024바이트 내 오프셋 헤더', C.hasPdfHeader(enc(' '.repeat(100) + '%PDF-1.7')) === true);
check('1024바이트 밖 헤더는 거부', C.hasPdfHeader(enc(' '.repeat(1200) + '%PDF-1.7')) === false);
check('비-PDF 거부', C.hasPdfHeader(enc('hello world')) === false);
check('null 안전', C.hasPdfHeader(null) === false);
check('ArrayBuffer 수용', C.hasPdfHeader(enc('%PDF-').buffer) === true);

// ===== 열기 실패 분류 =====
section('classifyOpenFailure');
const pdfBytes = enc('%PDF-1.4');
check('EncryptedPDFError → protected', C.classifyOpenFailure({ name: 'EncryptedPDFError', message: 'x' }, pdfBytes) === 'protected');
check('encrypted 메시지 → protected', C.classifyOpenFailure({ name: 'Error', message: 'document is encrypted' }, pdfBytes) === 'protected');
check('헤더 없음 → not-pdf', C.classifyOpenFailure({ name: 'Error', message: 'parse' }, enc('junk')) === 'not-pdf');
check('헤더 있음 + 일반 오류 → corrupt', C.classifyOpenFailure({ name: 'Error', message: 'parse' }, pdfBytes) === 'corrupt');
check('오류 메시지 3종 정의', ['protected', 'not-pdf', 'corrupt'].every(k => typeof C.OPEN_FAILURE_MESSAGES[k] === 'string'));
check('오류 메시지에 "업로드" 금지 (CONTEXT.md)', !Object.values(C.OPEN_FAILURE_MESSAGES).some(s => s.includes('업로드')));

// ===== 모션 코어 (2단계에서 추가 — 존재할 때만 검증) =====
if (typeof C.springStep === 'function') {
  section('spring — 수렴·연속성');
  // 감쇠비 1.0, response 0.4: 목표에 수렴해야 한다
  {
    let s = { value: 0, velocity: 0 };
    for (let i = 0; i < 300; i++) s = C.springStep(s, 90, 1.0, 0.4, 1 / 60);
    check('critically damped가 목표 90에 수렴', Math.abs(s.value - 90) < 0.1 && Math.abs(s.velocity) < 0.5);
  }
  // 감쇠비 0.8: 오버슈트가 존재해야 한다 (언더댐핑의 정의)
  {
    let s = { value: 0, velocity: 0 }, maxV = 0;
    for (let i = 0; i < 300; i++) { s = C.springStep(s, 90, 0.8, 0.4, 1 / 60); maxV = Math.max(maxV, s.value); }
    check('underdamped(0.8)는 오버슈트 후 수렴', maxV > 90.5 && Math.abs(s.value - 90) < 0.1);
  }
  // 초기 속도 인계: 양의 초기 속도는 첫 스텝 진행을 가속해야 한다
  {
    const still = C.springStep({ value: 0, velocity: 0 }, 90, 1.0, 0.4, 1 / 60);
    const thrown = C.springStep({ value: 0, velocity: 600 }, 90, 1.0, 0.4, 1 / 60);
    check('릴리스 속도 인계 시 더 빨리 진행', thrown.value > still.value);
  }
  // 재타기팅 연속성: 목표가 바뀌어도 현재 상태에서 이어받으므로 값이 점프하지 않는다 (§3 brick wall 금지)
  {
    let s = { value: 0, velocity: 0 };
    for (let i = 0; i < 30; i++) s = C.springStep(s, 90, 1.0, 0.4, 1 / 60);
    const before = s.value;
    const after = C.springStep(s, -90, 1.0, 0.4, 1 / 60); // 목표 반전
    check('재타기팅 직후 위치 연속 (한 프레임 변위 < 15°)', Math.abs(after.value - before) < 15);
  }
  // dt 안정성: 큰 dt에서도 발산하지 않는다
  {
    let s = { value: 0, velocity: 2000 };
    for (let i = 0; i < 100; i++) s = C.springStep(s, 90, 0.8, 0.4, 0.1);
    check('큰 dt(0.1s)에서도 발산 없음', Number.isFinite(s.value) && Math.abs(s.value - 90) < 1);
  }
}

if (typeof C.project === 'function') {
  section('project — 모멘텀 투사 (§6)');
  check('정지 상태 투사 = 0', C.project(0) === 0);
  check('스킬 수식 일치: v=1000, d=0.998 → 499', Math.abs(C.project(1000, 0.998) - 499) < 1e-9);
  check('음의 속도는 음의 투사', C.project(-1000) < 0);
}

if (typeof C.snapDetent === 'function') {
  section('snapDetent — 디텐트 선택');
  check('투사 지점 기준 최근접 90° 배수', C.snapDetent(130) === 90);
  check('135°는 상방 스냅', C.snapDetent(136) === 180);
  check('음각도 최근접', C.snapDetent(-50) === -90);
  check('0 근방', C.snapDetent(10) === 0);
}

if (typeof C.shortestDeg === 'function') {
  section('shortestDeg — 최단 각도차');
  check('350 → -10', C.shortestDeg(350) === -10);
  check('-350 → 10', C.shortestDeg(-350) === 10);
  check('170 → 170', C.shortestDeg(170) === 170);
  check('190 → -170', C.shortestDeg(190) === -170);
  check('0 → 0', C.shortestDeg(0) === 0);
}

if (typeof C.classifyDrag === 'function') {
  section('classifyDrag — 제스처 판별 (§10)');
  check('10px 미만은 pending (히스테리시스)', C.classifyDrag(5, 5, 0, 300) === 'pending');
  check('세로 우세 → rotate', C.classifyDrag(4, 20, 0, 300) === 'rotate');
  check('중앙 밴드 가로 → scroll', C.classifyDrag(20, 4, 10, 300) === 'scroll');
  check('상단 밴드 가로 → rotate (림 돌리기)', C.classifyDrag(20, 4, -150, 300) === 'rotate');
  check('하단 밴드 가로 → rotate', C.classifyDrag(-20, 4, 150, 300) === 'rotate');
}

if (typeof C.releaseDetent === 'function') {
  section('releaseDetent — 릴리스 결정 (§5·§6)');
  check('정지 릴리스: 40°는 0°로 복귀', C.releaseDetent(40, 0) === 0);
  check('정지 릴리스: 50°는 90°로 진행', C.releaseDetent(50, 0) === 90);
  check('속도가 경계를 넘긴다: 40° + 양의 플릭 → 90°', C.releaseDetent(40, 200) === 90);
  check('음의 플릭은 되돌린다: 50° - 플릭 → 0°', C.releaseDetent(50, -200) === 0);
  check('강한 플릭은 다음 디텐트를 건너뛸 수 있다', C.releaseDetent(45, 1000) >= 90);
}

// ===== 정적 HTML 계약 =====
section('HTML 계약');
check('[hidden] 방어 규칙', html.includes('[hidden] { display: none !important; }'));
check('뷰어 툴바 존재', html.includes('id="toolbar"'));
check('회전 버튼 2개 (270/90)', html.includes('data-delta="270"') && html.includes('data-delta="90"'));
check('각도 배지 존재', html.includes('id="angle-badge"'));
check('파일 이름 입력 존재', html.includes('id="name-input"'));
check('다운로드 버튼 존재', html.includes('id="download-button"'));
check('회전 버튼 aria-label', html.includes('aria-label="반시계 90° 회전"') && html.includes('aria-label="시계 90° 회전"'));
check('다크 토큰: prefers-color-scheme', html.includes('prefers-color-scheme: dark'));
check('다크 강제 훅: data-theme', html.includes('[data-theme="dark"]'));
check('reduced-motion 대응', html.includes('prefers-reduced-motion: reduce'));
check('reduced-transparency 대응', html.includes('prefers-reduced-transparency: reduce'));
check('고대비 대응', html.includes('prefers-contrast: more'));
check('재질: backdrop-filter', html.includes('backdrop-filter: blur('));
check('안전 영역: safe-area-inset-bottom', html.includes('env(safe-area-inset-bottom)'));
check('상태 문구 role=status', html.includes('role="status"'));
check('파일 입력 accept=pdf', html.includes('accept="application/pdf,.pdf"'));
check('"업로드" 표현 금지 (CONTEXT.md)', !html.includes('업로드'));
check('pdf.js 워커 고정 버전 일치', (html.match(/pdfjs-dist@3\.11\.174/g) || []).length >= 2);

// ===== 결과 =====
console.log(`\n${pass + fail} checks — pass ${pass}, fail ${fail}`);
process.exit(fail ? 1 : 0);
