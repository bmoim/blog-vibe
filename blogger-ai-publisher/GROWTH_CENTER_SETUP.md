# Blogger AI Publisher 성장 센터 설정

## 배포

Render 서비스의 Root Directory는 `blogger-ai-publisher`로 유지합니다.

- Build Command: `npm install`
- Start Command: `npm start`
- Health Check Path: `/health`

`npm start`는 서버 실행 전에 모든 주요 서버·브라우저 JavaScript 파일의 문법 검사를 수행합니다.

## Google OAuth 권한

Google 연결을 다시 승인하면 다음 읽기 권한을 요청합니다.

- Blogger 작성 및 관리
- Search Console 읽기
- Google Analytics 읽기
- AdSense 읽기

OAuth 동의 화면의 테스트 사용자에 실제 운영 Google 계정을 등록해야 합니다.

## Google Cloud에서 활성화할 API

- Blogger API v3
- Search Console API
- Google Analytics Data API
- Google Analytics Admin API
- AdSense Management API

## 성장 센터 최초 사용

1. `/growth.html`을 엽니다.
2. `Google 권한 다시 연결`을 누릅니다.
3. `Google 연결 자동 찾기`를 누릅니다.
4. Search Console, GA4, AdSense 항목을 확인합니다.
5. 작성자 이름·직함·소개·AI 활용 고지를 입력합니다.
6. `설정 저장`을 누릅니다.
7. `데이터 새로고침`을 눌러 검색·방문·수익 데이터를 확인합니다.

## 안전한 운영 순서

1. 글과 1:1 대표 썸네일 생성
2. 품질 검사
3. 중복 키워드 검사
4. 내부링크 추천 및 적용
5. 최신 정보 검수
6. 깨진 링크 점검
7. 작성자 신뢰도 박스 삽입
8. Blogger 초안 발행
9. 최종 검수 후 공개 발행
10. Search Console 색인 상태 확인

공개 발행 버튼을 누르면 품질 검사를 먼저 실행하고 현재 버전을 자동 백업합니다.

## 기존 공개 글 업데이트

성장 센터에서 초안을 선택한 뒤 `기존 공개 글 덮어쓰기`를 누르면, 해당 초안으로 마지막 공개 발행한 Blogger 게시물을 업데이트합니다. 업데이트 전 버전은 자동 백업됩니다.

## 백업

성장 센터 상단의 `전체 백업 다운로드`는 다음 항목을 JSON 파일로 저장합니다.

- 저장된 초안
- 생성 이미지
- 성장 센터 설정
- 예약 발행 대기열
- 초안 버전 기록
- 최신성 감시 결과

Google OAuth 토큰과 클라이언트 비밀번호는 보안을 위해 백업 파일에 포함하지 않습니다.

배포 변경 전이나 중요한 글을 많이 생성한 뒤에는 전체 백업을 내려받는 것을 권장합니다.

## 예약 발행

예약 시간은 대한민국 시간으로 해석합니다. 서버가 실행 중이면 매분 예약을 확인합니다. 서버가 중지되었다가 다시 실행되면 지나간 예약을 다음 확인 시 처리합니다.

## 금지 기능

이 프로그램은 다음 기능을 제공하지 않습니다.

- 광고 자동 클릭
- 봇 트래픽 생성
- 자동 새로고침을 통한 광고 노출 증가
- 사용자에게 광고 클릭을 요구하는 문구
- 검수 없는 무제한 자동 공개 발행
