# Nexus HR

AI 에이전트 기반 인재 검색 솔루션. Graph DB(정형 데이터)와 Vector DB(비정형 데이터)를 결합하여 최적의 인재를 추천합니다.

## Architecture

```
User Request
     │
     ▼
┌─────────────────┐
│  The Architect  │  검색 전략 수립
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ The Fact-Finder │  Neo4j Graph DB 조회 (정형 데이터)
└────────┬────────┘
         │
         ▼
┌──────────────────┐
│ The Insight-Seeker│  Vector DB 조회 (비정형 데이터)
└────────┬─────────┘
         │
         ▼
┌─────────────────┐
│ The Matchmaker  │  최종 추천 리포트 생성
└─────────────────┘
```

## Agents

| Agent | 역할 | 데이터 소스 |
|-------|------|-------------|
| **The Architect** | 사용자 요청 분석, 검색 전략 설계 | - |
| **The Fact-Finder** | Cypher 쿼리 생성 및 실행 | Neo4j (Graph DB) |
| **The Insight-Seeker** | 활동 로그에서 실무 역량 분석 | Vector DB |
| **The Matchmaker** | 정형+비정형 데이터 종합, 최종 점수 산출 | - |

## Tech Stack

- **Runtime**: Node.js + TypeScript (tsx)
- **AI Framework**: OpenAI Agents SDK
- **Graph DB**: Neo4j Aura
- **Vector DB**: TBD
- **Validation**: Zod

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/cme10575/nexus-hr.git
cd nexus-hr
npm install
```

### 2. Environment Variables

```bash
cp .env.example .env
```

`.env` 파일을 열고 실제 값을 입력:

```env
NEO4J_URI=neo4j+s://xxxxx.databases.neo4j.io
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=your-password
NEO4J_DATABASE=neo4j
OPENAI_API_KEY=sk-xxxx
```

### 3. Run

```bash
npx tsx nexus_hr.ts
```

## Example

**Input:**
```
카프카 경험이 있고 주문 도메인에서 3년 이상 일한 시니어 백엔드 개발자를 찾아줘
```

**Output:**
- **Architect**: 검색 전략 (Graph Filter + Vector Search 키워드)
- **Fact-Finder**: Neo4j 쿼리 실행 결과 (후보자 목록)
- **Insight-Seeker**: 후보자별 실무 역량 분석
- **Matchmaker**: 최종 추천 (match_score 0-100)

## Neo4j Schema

```
Nodes:
- Employee (id, name, exp_years, position)
- Skill (name)
- Project (name)
- Domain (name)

Relationships:
- (Employee)-[:HAS_SKILL]->(Skill)
- (Employee)-[:WORKED_ON]->(Project)
- (Project)-[:IN_DOMAIN]->(Domain)
```

## TODO

- [ ] Vector DB 연동 (searchActivityLogs 구현)
- [ ] 웹 UI 추가
- [ ] 스트리밍 응답 지원

## License

MIT
