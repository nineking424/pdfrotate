// 모션 프레임 캡처 — CDP Page.startScreencast로 회전 스프링·툴바 등장을 프레임 단위 기록
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8743';
const OUT = new URL('./motion/', import.meta.url).pathname;
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

const clickRotate = (page, delta) => page.evaluate((d) => {
  document.getElementById('app').contentDocument
    .querySelector(`.rotate-button[data-delta="${d}"]`).click();
}, delta);

// 1) 시계 90° 단일 회전 — 스프링 감쇠 특성
{
  const page = await viewerPage();
  const rec = record(page, 'rotate-cw', 1500);
  await new Promise(r => setTimeout(r, 100));
  await clickRotate(page, 90);
  await rec;
  await page.close();
}

// 2) 중도 개입 역전 — 시계 클릭 후 180ms 뒤 반시계 (§3 인터럽트)
{
  const page = await viewerPage();
  const rec = record(page, 'rotate-reverse', 1800);
  await new Promise(r => setTimeout(r, 100));
  await clickRotate(page, 90);
  await new Promise(r => setTimeout(r, 180));
  await clickRotate(page, 270);
  await rec;
  await page.close();
}

// 3) 연타 — 90° 두 번 빠르게 (재타기팅 연속성)
{
  const page = await viewerPage();
  const rec = record(page, 'rotate-double', 1800);
  await new Promise(r => setTimeout(r, 100));
  await clickRotate(page, 90);
  await new Promise(r => setTimeout(r, 150));
  await clickRotate(page, 90);
  await rec;
  await page.close();
}

// 4) 툴바 등장 — 파일 열림 전환 (§7)
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 1 });
  const rec = record(page, 'toolbar-enter', 4500);
  await page.goto(`${BASE}/harness.html?mode=viewer`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await rec;
  await page.close();
}

// 5) 툴바 퇴장 — 환영 화면 복귀, 등장과 대칭 경로 (§7)
{
  const page = await viewerPage();
  const rec = record(page, 'toolbar-exit', 1600);
  await new Promise(r => setTimeout(r, 200));
  await page.evaluate(() => {
    const win = document.getElementById('app').contentWindow;
    win.eval('resetToFileSelection(); clearPreview(); status.textContent = "";');
  });
  await rec;
  // 안착 후 rAF 루프 종료 확인 (권고 4)
  const rafs = await page.evaluate(() => {
    const win = document.getElementById('app').contentWindow;
    return { rotationRaf: win.eval('rotationRaf'), toolbarRaf: win.eval('toolbarRaf'),
             toolbarHidden: win.document.getElementById('toolbar').hidden };
  });
  console.log('raf-after-exit', JSON.stringify(rafs));
  await page.close();
}

// 6) 안착 후 rAF 종료 — 회전 안착 1초 뒤 루프 상태 (권고 4)
{
  const page = await viewerPage();
  await clickRotate(page, 90);
  await new Promise(r => setTimeout(r, 1800));
  const rafs = await page.evaluate(() => {
    const win = document.getElementById('app').contentWindow;
    return { rotationRaf: win.eval('rotationRaf'), toolbarRaf: win.eval('toolbarRaf'),
             display: win.eval('displayAngle'), target: win.eval('springTargetAngle') };
  });
  console.log('raf-after-settle', JSON.stringify(rafs));
  await page.close();
}

// 7) reduced-motion 증빙 — 클릭 직전/직후 정지 2프레임 (§14, 권고 3)
{
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.goto(`${BASE}/harness.html?mode=viewer`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => {
    const doc = document.getElementById('app').contentDocument;
    return doc && !doc.getElementById('preview-area').hidden &&
           doc.querySelectorAll('.preview-canvas').length > 0;
  }, { timeout: 20000 });
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: `${OUT}reduced-motion-before.png` });
  await clickRotate(page, 90);
  await new Promise(r => setTimeout(r, 80));
  await page.screenshot({ path: `${OUT}reduced-motion-after-80ms.png` });
  const st = await page.evaluate(() => {
    const win = document.getElementById('app').contentWindow;
    return { display: win.eval('displayAngle'), raf: win.eval('rotationRaf') };
  });
  console.log('reduced-motion', JSON.stringify(st));
  await page.close();
}

console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
