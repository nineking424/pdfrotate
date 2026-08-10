// 제스처 E2E — 원호 드래그·플릭·중도 개입을 실제 마우스 이벤트로 구동하고 프레임 기록
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8743';
const OUT = new URL('./gesture/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const errors = [];

async function record(page, name, ms) {
  const client = await page.createCDPSession();
  let i = 0;
  const t0 = Date.now();
  client.on('Page.screencastFrame', async (ev) => {
    const t = Date.now() - t0;
    writeFileSync(`${OUT}${name}-${String(i).padStart(3, '0')}-${t}ms.png`, Buffer.from(ev.data, 'base64'));
    i++;
    await client.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
  });
  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 2 });
  await new Promise(r => setTimeout(r, ms));
  await client.send('Page.stopScreencast');
  await client.detach();
  console.log(name, i + ' frames');
}

async function viewerPage() {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/harness.html?mode=viewer`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => {
    const doc = document.getElementById('app').contentDocument;
    return doc && !doc.getElementById('preview-area').hidden &&
           doc.querySelectorAll('.preview-canvas').length > 0;
  }, { timeout: 20000 });
  await new Promise(r => setTimeout(r, 300));
  return page;
}

// iframe 내부 첫 캔버스의 중심·크기 (최상위 좌표계)
async function canvasBox(page) {
  return page.evaluate(() => {
    const frame = document.getElementById('app');
    const fr = frame.getBoundingClientRect();
    const r = frame.contentDocument.querySelector('.preview-canvas').getBoundingClientRect();
    return { cx: fr.left + r.left + r.width / 2, cy: fr.top + r.top + r.height / 2,
             w: r.width, h: r.height };
  });
}

const state = (page) => page.evaluate(() => {
  const win = document.getElementById('app').contentWindow;
  return {
    delta: win.eval('accumulatedDelta'),
    badge: win.document.getElementById('angle-badge').textContent,
    name: win.document.getElementById('name-input').value,
  };
});

// 원호를 따라 마우스 드래그: 중심 기준 반지름 rad, fromDeg→toDeg를 steps로
async function arcDrag(page, box, radius, fromDeg, toDeg, steps, stepDelayMs, release) {
  const pt = (deg) => [
    box.cx + radius * Math.cos(deg * Math.PI / 180),
    box.cy + radius * Math.sin(deg * Math.PI / 180),
  ];
  const [x0, y0] = pt(fromDeg);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const deg = fromDeg + (toDeg - fromDeg) * i / steps;
    const [x, y] = pt(deg);
    await page.mouse.move(x, y);
    if (stepDelayMs) await new Promise(r => setTimeout(r, stepDelayMs));
  }
  if (release) await page.mouse.up();
}

// 1) 느린 원호 드래그 시계 80° → 릴리스 → 90° 스냅 기대
{
  const page = await viewerPage();
  const box = await canvasBox(page);
  const rec = record(page, 'drag-slow', 2600);
  await new Promise(r => setTimeout(r, 150));
  await arcDrag(page, box, box.h * 0.42, 90, 170, 24, 16, true); // 아래쪽 가장자리를 잡고 시계로
  await new Promise(r => setTimeout(r, 900));
  console.log('drag-slow state', JSON.stringify(await state(page)));
  await rec;
  await page.close();
}

// 2) 빠른 플릭 — 작은 이동 + 높은 각속도 → 모멘텀이 다음 디텐트로 던짐 (§6)
{
  const page = await viewerPage();
  const box = await canvasBox(page);
  const rec = record(page, 'drag-flick', 2200);
  await new Promise(r => setTimeout(r, 150));
  await arcDrag(page, box, box.h * 0.42, 90, 130, 6, 4, true); // 40°를 매우 빠르게
  await new Promise(r => setTimeout(r, 900));
  console.log('drag-flick state', JSON.stringify(await state(page)));
  await rec;
  await page.close();
}

// 3) 중도 개입 — 버튼 회전 스냅 중에 잡아서 반대로 끌고 릴리스 (§3)
{
  const page = await viewerPage();
  const box = await canvasBox(page);
  const rec = record(page, 'drag-interrupt', 3000);
  await new Promise(r => setTimeout(r, 100));
  await page.evaluate(() => {
    document.getElementById('app').contentDocument
      .querySelector('.rotate-button[data-delta="90"]').click();
  });
  await new Promise(r => setTimeout(r, 160)); // 스냅 비행 중
  await arcDrag(page, box, box.h * 0.42, 90, 40, 18, 16, true); // 잡아서 반시계로 되돌림
  await new Promise(r => setTimeout(r, 900));
  console.log('drag-interrupt state', JSON.stringify(await state(page)));
  await rec;
  await page.close();
}

// 4) 중앙 밴드 가로 드래그 = 스크롤 (판별 검증, 상태 불변 기대)
{
  const page = await viewerPage();
  const box = await canvasBox(page);
  const before = await state(page);
  await page.mouse.move(box.cx, box.cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(box.cx - i * 25, box.cy + (i % 2)); // 수평 왕복 없는 직선
    await new Promise(r => setTimeout(r, 10));
  }
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 400));
  const after = await state(page);
  const scrolled = await page.evaluate(() =>
    document.getElementById('app').contentDocument.getElementById('preview-strip').scrollLeft);
  console.log('scroll-test', JSON.stringify({ before: before.delta, after: after.delta, scrollLeft: scrolled }));
  await page.close();
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
