# pdfrotate

## Agent skills

### Issue tracker

이슈는 이 저장소의 GitHub Issues에서 관리한다 (`gh` CLI 사용). See `docs/agents/issue-tracker.md`.

### Triage labels

기본 라벨 5종을 그대로 사용한다 (needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

단일 컨텍스트 — 루트 `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

### Design constitution

표현 계층(비주얼·모션·타이포)의 기준 문서는 루트 `apple-design.md`다 (ADR-0001).
UI를 만들거나 고칠 때는 이 문서의 원칙을 따르고, 변경 후 `node verify.mjs` 통과를 확인한다.
