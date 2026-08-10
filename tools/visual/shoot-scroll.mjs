// 스트립 스크롤 관성(§6)·러버밴딩(§9) E2E — 프레임 + 릴리스 속도 계측 로그
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8743';
const OUT = new URL('./scroll/', import.meta.url).pathname;
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

async function viewerPage(pages) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/harness.html?mode=viewer&pages=${pages}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => {
    const doc = document.getElementById('app').contentDocument;
    return doc && !doc.getElementById('preview-area').hidden &&
           doc.querySelectorAll('.preview-canvas').length > 0;
  }, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 300));
  return page;
}

const ev = (page, expr) => page.evaluate((x) =>
  document.getElementById('app').contentWindow.eval(x), expr);

const centerBand = (page) => page.evaluate(() => {
  const frame = document.getElementById('app');
  const fr = frame.getBoundingClientRect();
  const r = frame.contentDocument.querySelector('.preview-canvas').getBoundingClientRect();
  return { x: fr.left + r.left + r.width / 2, y: fr.top + r.top + r.height / 2 };
});

// 페이지 컨텍스트에 pointer 이벤트 타임스탬프 로거 설치 (계측 증빙용)
async function installPointerLog(page) {
  await page.evaluate(() => {
    const win = document.getElementById('app').contentWindow;
    win.__ptrLog = [];
    const strip = win.document.getElementById('preview-strip');
    for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
      strip.addEventListener(type, (e) => {
        win.__ptrLog.push({ type: type, t: Math.round(e.timeStamp), x: Math.round(e.clientX) });
      }, true);
    }
  });
}

// scrollLeft를 rAF 간격으로 샘플링해 속도 곡선 산출용 시계열을 만든다
async function startScrollSampler(page) {
  await page.evaluate(() => {
    const win = document.getElementById('app').contentWindow;
    const strip = win.document.getElementById('preview-strip');
    win.__samples = [];
    const tick = (ts) => {
      win.__samples.push({ t: Math.round(ts), sl: Math.round(strip.scrollLeft * 10) / 10 });
      if (win.__samples.length < 400) win.requestAnimationFrame(tick);
    };
    win.requestAnimationFrame(tick);
  });
}

function velocitySeries(samples) {
  const out = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = (samples[i].t - samples[i - 1].t) / 1000;
    if (dt > 0) out.push({ t: samples[i].t, v: Math.round((samples[i].sl - samples[i - 1].sl) / dt) });
  }
  return out;
}

async function flick(page, c, stepPx, steps, stepDelay) {
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  let lastVx = 0;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(c.x - i * stepPx, c.y + (i % 2));
    if (i === steps) lastVx = await ev(page, 'drag ? drag.scrollVx : 0');
    if (stepDelay) await new Promise(r => setTimeout(r, stepDelay));
  }
  await page.mouse.up();
  return lastVx;
}

// 1) 중간 세기 플릭 — 스트립 중간 착지, 카드 중앙 정렬 스냅 경로 검증 + 전체 계측
{
  const page = await viewerPage(6);
  await installPointerLog(page);
  const c = await centerBand(page);
  const rec = record(page, 'flick-mid', 3000);
  await new Promise(r => setTimeout(r, 150));
  await startScrollSampler(page);
  const codeVx = await flick(page, c, 22, 8, 12); // 완만한 플릭
  await new Promise(r => setTimeout(r, 60));
  const glide = await page.evaluate(() => {
    const win = document.getElementById('app').contentWindow;
    return { mode: win.eval('glideMode'), rate: win.eval('glideRate'),
             target: Math.round(win.eval('scrollTarget')) };
  });
  await new Promise(r => setTimeout(r, 2200));
  const final = await page.evaluate(() => {
    const win = document.getElementById('app').contentWindow;
    const strip = win.document.getElementById('preview-strip');
    const center = strip.clientWidth / 2;
    const cards = [...strip.querySelectorAll('.page-frame')].map(f =>
      Math.round(f.offsetLeft + f.offsetWidth / 2 - strip.scrollLeft - center));
    return { scrollLeft: Math.round(strip.scrollLeft),
             max: Math.round(strip.scrollWidth - strip.clientWidth),
             raf: win.eval('scrollRaf'),
             nearestCardCenterOffset: cards.reduce((a, b) => Math.abs(a) < Math.abs(b) ? a : b),
             samples: win.__samples, ptr: win.__ptrLog.slice(-6) };
  });
  console.log('flick-mid codeReleaseVx(px/s):', Math.round(codeVx));
  console.log('flick-mid glide:', JSON.stringify(glide));
  console.log('flick-mid final:', JSON.stringify({ scrollLeft: final.scrollLeft, max: final.max,
    raf: final.raf, nearestCardCenterOffset: final.nearestCardCenterOffset }));
  console.log('flick-mid pointer-log(tail):', JSON.stringify(final.ptr));
  console.log('flick-mid velocity-series(px/s):',
    JSON.stringify(velocitySeries(final.samples).filter(s => s.v !== 0).slice(0, 40)));
  await rec;
  await page.close();
}

// 2) 강한 플릭 — 경계 도달 → 잔여 속도 바운스 (§9)
{
  const page = await viewerPage(6);
  const c = await centerBand(page);
  const rec = record(page, 'flick-boundary', 3200);
  await new Promise(r => setTimeout(r, 150));
  // 바운스 극값 기록기 — rbOffset의 최소/최대를 rAF로 추적
  await page.evaluate(() => {
    const win = document.getElementById('app').contentWindow;
    win.__rbExtremes = { min: 0, max: 0 };
    const tick = () => {
      const v = win.eval('rbOffset');
      if (v < win.__rbExtremes.min) win.__rbExtremes.min = v;
      if (v > win.__rbExtremes.max) win.__rbExtremes.max = v;
      win.requestAnimationFrame(tick);
    };
    win.requestAnimationFrame(tick);
  });
  const codeVx = await flick(page, c, 70, 8, 4); // 고속 플릭 — 경계 초과 투사
  await new Promise(r => setTimeout(r, 60));
  const glide = await page.evaluate(() => {
    const win = document.getElementById('app').contentWindow;
    return { mode: win.eval('glideMode'), target: Math.round(win.eval('scrollTarget')) };
  });
  await new Promise(r => setTimeout(r, 2800));
  const final = await page.evaluate(() => {
    const win = document.getElementById('app').contentWindow;
    const strip = win.document.getElementById('preview-strip');
    return { scrollLeft: Math.round(strip.scrollLeft),
             transform: strip.style.transform, rbRaf: win.eval('rbRaf'),
             bounce: win.__rbExtremes };
  });
  console.log('flick-boundary codeReleaseVx:', Math.round(codeVx), 'glide:', JSON.stringify(glide));
  console.log('flick-boundary final:', JSON.stringify(final));
  await rec;
  await page.close();
}

// 3) 러버밴딩 드래그 (기존 시나리오 유지)
{
  const page = await viewerPage(6);
  const c = await centerBand(page);
  const rec = record(page, 'scroll-rubberband', 2600);
  await new Promise(r => setTimeout(r, 150));
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(c.x + i * 30, c.y + (i % 2));
    await new Promise(r => setTimeout(r, 16));
  }
  const stretched = await ev(page, 'rbOffset');
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 900));
  console.log('rubberband stretch(px):', Math.round(stretched),
    'after:', JSON.stringify(await ev(page, '({t: previewStrip.style.transform, raf: rbRaf})')));
  await rec;
  await page.close();
}

// 4) 글라이드 중 재그랩 — 정지 이후까지 프레임 증빙 (§3).
// 스크린캐스트는 화면 변화가 있을 때만 프레임을 내보내므로, 그랩 후 정지 상태를
// 증명하려면 이어지는 저속 드래그로 "멈춘 지점에서 1:1로 이어받음"을 보여준다.
{
  const page = await viewerPage(6);
  const c = await centerBand(page);
  const rec = record(page, 'glide-regrab', 3200);
  await new Promise(r => setTimeout(r, 150));
  await flick(page, c, 45, 8, 8);
  await new Promise(r => setTimeout(r, 150)); // 글라이드 비행 중
  const mid = await ev(page, '({sl: Math.round(previewStrip.scrollLeft), raf: scrollRaf})');
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();               // 재그랩 — 그 자리에서 정지해야 한다
  await new Promise(r => setTimeout(r, 60));
  const grabbed = await ev(page, '({sl: Math.round(previewStrip.scrollLeft), raf: scrollRaf})');
  await new Promise(r => setTimeout(r, 400)); // 정지 유지 구간
  const held = await ev(page, 'Math.round(previewStrip.scrollLeft)');
  await page.mouse.up();
  // 멈춘 지점에서 저속 1:1 드래그로 이어받기 — 지금 화면에 보이는 카드 위에서
  const vis = await page.evaluate(() => {
    const frame = document.getElementById('app');
    const fr = frame.getBoundingClientRect();
    for (const cv of frame.contentDocument.querySelectorAll('.preview-canvas')) {
      const r = cv.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      if (cx > 100 && cx < 1000) return { x: fr.left + cx, y: fr.top + r.top + r.height / 2 };
    }
    return null;
  });
  await page.mouse.move(vis.x, vis.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(vis.x - i * 12, vis.y + (i % 2));
    await new Promise(r => setTimeout(r, 40));
  }
  const dragged = await ev(page, 'Math.round(previewStrip.scrollLeft)');
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 600));
  console.log('regrab:', JSON.stringify({ mid: mid, grabbed: grabbed, heldStill: held,
    afterSlowDrag: dragged }));
  await rec;
  await page.close();
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
