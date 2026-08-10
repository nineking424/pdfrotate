// 스크린샷 촬영기 — 설치된 Chrome을 puppeteer-core로 구동 (실시간, pdf.js 워커 정상 동작)
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:8743';
const SHOTS = new URL('./shots/', import.meta.url).pathname;

const scenarios = [
  { name: 'welcome-light',        w: 1280, h: 900, q: '' },
  { name: 'welcome-dark',         w: 1280, h: 900, q: '?theme=dark' },
  { name: 'viewer-light',         w: 1280, h: 900, q: '?mode=viewer', wait: 'canvas' },
  { name: 'viewer-dark',          w: 1280, h: 900, q: '?mode=viewer&theme=dark', wait: 'canvas' },
  { name: 'viewer-rotated-light', w: 1280, h: 900, q: '?mode=viewer&rotate=90', wait: 'rotated' },
  { name: 'welcome-mobile-light', w: 390,  h: 844, q: '' },
  { name: 'viewer-mobile-light',  w: 390,  h: 844, q: '?mode=viewer', wait: 'canvas' },
  { name: 'viewer-mobile-dark',   w: 390,  h: 844, q: '?mode=viewer&theme=dark&rotate=90', wait: 'rotated' },
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
try {
  for (const s of scenarios) {
    const page = await browser.newPage();
    await page.setViewport({ width: s.w, height: s.h, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/harness.html${s.q}`, { waitUntil: 'networkidle2', timeout: 30000 });
    if (s.wait === 'canvas' || s.wait === 'rotated') {
      await page.waitForFunction(() => {
        const doc = document.getElementById('app').contentDocument;
        return doc && !doc.getElementById('preview-area').hidden &&
               doc.querySelectorAll('.preview-canvas').length > 0;
      }, { timeout: 20000 });
    }
    if (s.wait === 'rotated') {
      await page.waitForFunction(() => {
        const doc = document.getElementById('app').contentDocument;
        const c = doc && doc.querySelector('.preview-canvas');
        return c && c.width > c.height; // 가로 페이지 = 회전 반영 완료
      }, { timeout: 20000 });
    }
    await new Promise(r => setTimeout(r, 400)); // 폰트·페인트 안정화
    await page.screenshot({ path: `${SHOTS}${s.name}.png` });
    await page.close();
    console.log('shot', s.name);
  }
} finally {
  await browser.close();
}
