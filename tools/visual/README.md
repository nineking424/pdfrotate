# 시각·모션 검증 도구

apple-design.md 기준의 시각 층 검증 스크립트. 수치 층은 루트 `node verify.mjs`.

## 준비

```sh
npm install puppeteer-core           # 작업 디렉터리 어디든 (설치된 Chrome을 구동)
mkdir stage && cd stage
ln -sf ../../index.html index.html   # 저장소 index.html을 스테이지에 링크
cp ../tools/visual/harness.html .
python3 -m http.server 8743 --bind 127.0.0.1 &
```

스크립트 상단의 `BASE`(포트)와 출력 경로를 환경에 맞게 조정한다.

## 구성

- `harness.html` — index.html을 iframe으로 감싸 파일 주입·테마 강제·회전을 쿼리로 제어.
  pdf-lib로 3페이지 샘플을 iframe 렘 안에서 생성한다(렘 밖 배열은 instanceof 검사에 걸림).
  쿼리: `?mode=viewer&theme=dark&rotate=90`
- `shoot.mjs` — 정지 화면 8종(라이트/다크 × 데스크톱/모바일 × 환영/뷰어/회전)
- `shoot-motion.mjs` — CDP 스크린캐스트로 회전 스프링·역전·연타·툴바 등장/퇴장·
  reduced-motion 프레임 시퀀스 캡처 + rAF 종료 계측
- `shoot-gesture.mjs` — 실제 마우스 이벤트로 원호 드래그·플릭·중도 개입·스크롤 판별 E2E
- `check-reduced-motion.mjs` — prefers-reduced-motion 에뮬레이션 계측

## 주의

- 헤드리스 `--virtual-time-budget`은 pdf.js 워커와 스프링 실시간 특성을 왜곡한다 —
  반드시 puppeteer 실시간 구동을 쓴다 (ADR-0001).
- 프레임 시퀀스는 `이름-순번-시각ms.png` 형식. ffmpeg로 GIF 인코딩 가능:
  `ffmpeg -framerate 20 -i seq/%04d.png -vf "scale=880:-1,split[a][b];[a]palettegen[p];[b][p]paletteuse" out.gif`
