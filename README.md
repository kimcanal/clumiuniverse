# CLUMI UNIVERSE

합정과 상수 사이 조용한 골목에 있는 감성 카페 **클루미 유니버스**의 공식 웹사이트입니다. 시그니처 파르페, 벨기에 리에주 방식의 수제 와플, 시즌 케이크와 와플 브런치를 소개하고 픽업 주문과 매장 방문으로 연결합니다.

[![Live Site](https://img.shields.io/badge/Live-Netlify-00C7B7?logo=netlify&logoColor=white)](https://clumiuniverse.netlify.app/)
[![토스 메뉴 자동 동기화](https://github.com/kimcanal/clumiuniverse/actions/workflows/toss-menu-sync.yml/badge.svg)](https://github.com/kimcanal/clumiuniverse/actions/workflows/toss-menu-sync.yml)
![Stack](https://img.shields.io/badge/Stack-HTML%20%2F%20CSS%20%2F%20JavaScript-F7C948)

[![CLUMI UNIVERSE 웹사이트 화면](./docs/screenshots/home-desktop.webp)](https://clumiuniverse.netlify.app/)

> 합정과 상수 사이, 번잡한 홍대 레드로드를 벗어나 조용한 골목에서 따뜻한 위로와 작은 휴식을 전하는 감성 카페, 클루미 유니버스입니다. 날씨와 마음을 닮은 귀여운 캐릭터 스토리와 함께 매일 정성스럽게 준비하는 특별한 시그니처 디저트를 선보입니다.

## 주요 기능

- 토스오더 메뉴·가격·판매 상태·이미지·`인기`/`신규` 라벨 동기화
- 추천, 인기, 신규, 와플, 브런치, 커피, 디저트, 음료별 메뉴 탐색
- 네이버 지도 기반 매장 소개, 주소, 영업시간, 전화 연결
- 네이버 리뷰 하이라이트와 토스 픽업 주문 연결
- 데스크톱과 모바일에 대응하는 반응형 단일 페이지

## 데이터 운영 현황

| 데이터 | 원본 | 갱신 방식 | 주기 |
| --- | --- | --- | --- |
| 메뉴·가격·이미지 | [토스오더](https://store.tossplace.com/order/238090) | GitHub Actions 자동 동기화 | 매일 KST 06:00 + 수동 실행 |
| 추천 메뉴 | `data/featured.json` | 메뉴 ID를 직접 선택 | 필요할 때 |
| 숨김 메뉴 | `data/hidden-menu-items.json` | 노출하지 않을 메뉴 ID 관리 | 필요할 때 |
| 매장 소개·영업시간 | [네이버 지도](https://naver.me/F9hNJomf) | `data/store-info.json` 수동 관리 | 정보 변경 시 |
| 리뷰 하이라이트 | 네이버 방문자 리뷰 | `data/reviews.json` 수동 관리 | 필요할 때 |
| Instagram | [@clumi.universe](https://www.instagram.com/clumi.universe/) | 이미지와 게시물 링크 수동 관리 | 필요할 때 |

Instagram은 계정 API 권한을 보유하지 않아 자동 수집하지 않습니다. 공개 페이지 스크래핑 대신 저장소의 승인된 이미지와 게시물 링크만 사용합니다.

## 토스 메뉴 동기화

```text
Toss Place 주문 데이터
        ↓
GitHub Actions · 매일 KST 06:00
        ↓
menu.json · menu.csv · 메뉴 이미지
        ↓
main 브랜치 커밋
        ↓
Netlify 자동 배포
```

동기화 스크립트는 메뉴의 실제 내용이 바뀐 경우에만 파일을 갱신합니다. 실행 시각이나 매장 영업 상태만 달라졌다면 커밋과 불필요한 Netlify 재배포를 만들지 않습니다.

수동으로 최신 메뉴를 받으려면 다음 명령을 실행합니다.

```bash
node scripts/fetch-toss-menu.mjs
```

이미지 다운로드 없이 데이터만 확인할 수도 있습니다.

```bash
node scripts/fetch-toss-menu.mjs --no-images
```

> 현재 스크립트는 토스오더 주문 페이지가 사용하는 공개 응답을 읽습니다. 토스 측 응답 형식이 바뀌면 스크립트 수정이 필요할 수 있습니다.

### 대표 메뉴 바꾸기

대표 메뉴는 `data/featured.json`에 적힌 메뉴 ID 순서대로 표시됩니다. 메뉴 ID는 `data/tossplace-menu/238090/menu.json`의 `items[].id`를 사용합니다.

```bash
node scripts/update-menu.mjs
```

검증만 하고 메뉴 선택과 배포를 건너뛰려면 다음처럼 실행합니다.

```bash
node scripts/update-menu.mjs --no-fetch --keep --no-deploy
```

`인기`와 `신규` 탭은 토스 메뉴의 `labels` 값을 자동으로 읽습니다. 소스, 옵션, 굿즈처럼 홈페이지 메뉴 카드에 어울리지 않는 항목은 `data/hidden-menu-items.json`에 ID를 추가해 숨깁니다.

## 매장 정보와 Instagram 수정

매장 소개, 주소, 영업시간, 전화번호와 네이버 지도 링크는 `data/store-info.json`에서 관리합니다.

- 화면용 영업시간: `hours.weekday`, `hours.weekend`, `hours.note`
- 오늘 영업 상태 계산: `businessHours.weekday`, `businessHours.weekend`
- 네이버 지도 링크: `links.naverMap`
- 네이버 지도 기준 소개 문구: `description`, `closingMessage`

`businessHours`는 `HH:MM` 형식으로 입력합니다.

Instagram 게시물을 바꿀 때는 `assets/instagram/`의 이미지를 교체하고 `index.html`의 `.instagram-tile` 링크와 대체 텍스트를 함께 수정합니다.

## 로컬 실행

별도 빌드나 패키지 설치가 필요하지 않은 정적 사이트입니다.

```bash
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000`을 열면 됩니다. `file://`로 직접 열면 JSON `fetch`가 차단될 수 있으므로 로컬 서버를 사용합니다.

## 배포

프로덕션 주소는 <https://clumiuniverse.netlify.app/>입니다. `main` 브랜치가 갱신되면 Netlify가 저장소 루트를 정적 자산으로 자동 배포합니다.

```bash
git status
git add <변경한 파일>
git commit -m "update: 변경 내용"
git push origin main
```

## 프로젝트 구조

```text
clumiuniverse/
├── .github/workflows/toss-menu-sync.yml
├── docs/screenshots/
├── index.html
├── styles.css
├── assets/
│   ├── bg/
│   ├── characters/
│   └── instagram/
├── data/
│   ├── featured.json
│   ├── hidden-menu-items.json
│   ├── reviews.json
│   ├── store-info.json
│   └── tossplace-menu/238090/
│       ├── menu.json
│       ├── menu.csv
│       ├── state.json
│       └── images/
└── scripts/
    ├── fetch-toss-menu.mjs
    └── update-menu.mjs
```
