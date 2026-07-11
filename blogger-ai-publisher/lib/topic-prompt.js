export function defaultTopicInputs() {
  return {
    sitePurpose: "돈과 시간을 아끼는 생활 문제 해결 블로그. 보험·보장·청구 실무, 정부지원·생활비 절감, 스마트폰·AI·ChatGPT 오류 해결을 중심으로 한다.",
    expertise: "보험설계사 현장 경험, 보험금 청구와 보장 분석 경험, AI 콘텐츠 제작과 블로그 운영 경험, 실제 생활 문제를 쉽게 설명하는 능력",
    pillars: "보험·실손·운전자보험·보험금 청구 | 정부지원·세금·생활비 절감 | 스마트폰·AI·ChatGPT 오류 해결",
    audience: "보험·생활비·스마트폰 문제를 검색으로 해결하려는 한국의 30~60대 일반 독자"
  };
}

export function buildTopicPrompt({ input, count, drafts, searchSignals, currentDate }) {
  const evergreen = Math.round(count * 0.7);
  const updates = Math.round(count * 0.2);
  const experiments = count - evergreen - updates;
  return `오늘은 대한민국 시간 기준 ${currentDate}다. 한국어 블로그 편집장과 검색 수요 분석가로서 사용자가 주제를 고민하지 않도록 정확히 ${count}개의 실행 가능한 글 주제를 1개월 콘텐츠 캘린더로 설계하라.

사이트 목적: ${input.sitePurpose}
운영자의 실제 경험: ${input.expertise}
핵심 콘텐츠 기둥: ${input.pillars}
주요 독자: ${input.audience}
월 수익 목표: ${input.monthlyRevenueGoal.toLocaleString("ko-KR")}원
글 구성: 에버그린 문제해결형 ${evergreen}개, 최신 업데이트형 ${updates}개, 실험형 ${experiments}개

기존 글 제목:
${JSON.stringify(drafts)}

최근 90일 Search Console 검색어 신호:
${searchSignals.length ? JSON.stringify(searchSignals.slice(0, 100)) : "연결된 데이터 없음"}

규칙:
1. 무작위 유행어가 아니라 사이트 목적과 주제 기둥 안에서만 확장한다.
2. 웹 검색으로 현재 한국에서 실제로 유효한 제도, 가격, 서비스, 오류, 제품, 정책, 일정과 독자 질문을 조사한다.
3. Search Console 데이터가 있으면 노출은 있으나 클릭이 낮거나 평균 순위가 4~20위인 질문형·비교형·비용형 검색어를 우선한다.
4. 기존 글과 같은 검색 의도를 피하고 existing_gap에 차별점을 쓴다.
5. 실제 검색량과 CPC를 확인하지 못했다면 숫자를 만들지 않는다. 점수는 계획 내부의 상대 평가이며 수익 보장이 아니다.
6. 보험·건강·금융·세금·지원금은 공식 기관과 최신 원문을 확인하고 운영자의 경험 범위를 벗어난 단정을 피한다.
7. 제목은 검색자의 질문에 답이 바로 보이도록 구체적으로 쓴다.
8. 가격, 비용, 조건, 대상, 비교, 신청, 청구, 오류 해결, 수수료, 환급, 가입 전 확인처럼 실제 행동 직전 문제를 우선한다.
9. 하나의 기둥 글과 여러 하위 글이 연결되는 토픽 클러스터를 만든다.
10. authority_fit은 실제 전문성에 맞을수록 높게, 경쟁이 매우 센 대형 키워드는 competition_opportunity를 낮게 준다.
11. overall은 demand 25%, revenue_intent 20%, authority_fit 25%, competition_opportunity 20%, freshness 10%를 참고한다.
12. day 1~3에는 빨리 성과를 확인할 수 있고 작성 난도가 지나치게 높지 않은 주제를 배치한다.
13. official_sources_to_check에는 기관명이나 공식 사이트 종류만 적고 확인하지 않은 URL을 만들지 않는다.
14. monetization_path에는 예상 수익액 대신 연결 가능한 광고주 카테고리와 상업 의도를 설명한다.
15. 검색 순위 조작용 대량 자동생성이 아니라 독자가 실제 문제를 해결하는 사람 중심 콘텐츠 계획으로 작성한다.

지정된 JSON 스키마만 반환하라.`;
}
