// prefers-reduced-motion 에뮬레이션 — 스프링 생략·즉시 반영 확인 (§14)
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.setViewport({ width: 1100, height: 800 });
await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
await page.goto('http://127.0.0.1:8743/harness.html?mode=viewer', { waitUntil: 'networkidle2' });
await page.waitForFunction(() => {
  const doc = document.getElementById('app').contentDocument;
  return doc && !doc.getElementById('preview-area').hidden &&
         doc.querySelectorAll('.preview-canvas').length > 0;
}, { timeout: 20000 });

// iframe도 media feature를 상속하는지 + 회전이 즉시 반영되는지
const res = await page.evaluate(async () => {
  const win = document.getElementById('app').contentWindow;
  const doc = win.document;
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  doc.querySelector('.rotate-button[data-delta="90"]').click();
  // 즉시(다음 매크로태스크) 스프링 라프 없이 목표 도달해야 한다
  await new Promise(r => setTimeout(r, 50));
  const mid = {
    display: win.eval('displayAngle'),
    raf: win.eval('rotationRaf'),
  };
  // 크리스프 렌더 완료 대기
  await new Promise(r => setTimeout(r, 1200));
  const c = doc.querySelector('.preview-canvas');
  return {
    reduced: reduced,
    midDisplay: mid.display, midRaf: mid.raf,
    delta: win.eval('accumulatedDelta'),
    landscape: c.width > c.height,
    transform: c.style.transform,
    toolbarHidden: doc.getElementById('toolbar').hidden,
    toolbarTransform: doc.getElementById('toolbar').style.transform,
  };
});
console.log(JSON.stringify(res, null, 2));
await browser.close();
