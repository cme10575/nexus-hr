import "dotenv/config";
import { tool, Agent, AgentInputItem, Runner, withTrace } from "@openai/agents";
import { z } from "zod";
import neo4j, { Driver } from "neo4j-driver";

// Neo4j 연결 설정
const NEO4J_URI = process.env.NEO4J_URI || "bolt://localhost:7687";
const NEO4J_USERNAME = process.env.NEO4J_USERNAME || "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || "password";

let driver: Driver | null = null;

function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      NEO4J_URI,
      neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD)
    );
  }
  return driver;
}

async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

// Tool definitions
const executeCypherQuery = tool({
  name: "executeCypherQuery",
  description: "Neo4j 데이터베이스에서 후보자 정보를 조회하기 위해 Cypher 쿼리를 실행합니다.",
  parameters: z.object({
    query: z.string()
  }),
  execute: async (input: {query: string}) => {
    const session = getDriver().session();
    try {
      const result = await session.run(input.query);
      const records = result.records.map(record => {
        const obj: Record<string, unknown> = {};
        record.keys.forEach(key => {
          const value = record.get(key);
          if (neo4j.isInt(value)) {
            obj[key] = value.toNumber();
          } else if (value && typeof value === 'object' && 'properties' in value) {
            obj[key] = value.properties;
          } else {
            obj[key] = value;
          }
        });
        return obj;
      });
      return JSON.stringify(records, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Query execution failed: ${message}`;
    } finally {
      await session.close();
    }
  },
});

const searchActivityLogs = tool({
  name: "searchActivityLogs",
  description: "특정 후보자들의 비정형 활동 로그(GitHub PR, Slack, Jira 등)에서 기술적 역량과 협업 스타일에 대한 구체적 증거를 검색합니다.",
  parameters: z.object({
    candidate_ids: z.array(z.string()),
    query_keywords: z.array(z.string()),
    top_k: z.number().int()
  }),
  execute: async (input: {candidate_ids: string[], query_keywords: string[], top_k: number}) => {
    // TODO: Vector DB 연동 구현
    return JSON.stringify({
      message: "Vector search not implemented yet",
      searched_candidates: input.candidate_ids,
      keywords: input.query_keywords,
      top_k: input.top_k
    });
  },
});

// Schema definitions
const TheArchitectSchema = z.object({
  reasoning: z.string(),
  graph_filter: z.object({
    target_skills: z.array(z.string()),
    target_domain: z.string(),
    min_experience: z.string(),
    project_keywords: z.array(z.string())
  }),
  vector_search: z.object({
    technical_depth_keywords: z.array(z.string()),
    soft_skill_keywords: z.array(z.string()),
    evidence_to_find: z.string()
  })
});

const TheFactFinderSchema = z.object({
  executed_query: z.string().describe("실행한 Cypher 쿼리"),
  reasoning: z.string().describe("DB 검색 결과에 대한 요약 및 후보 선정 근거"),
  candidates: z.array(z.object({
    id: z.string().describe("직원 고유 ID (벡터 DB 조회용 키)"),
    name: z.string().describe("직원 성함"),
    position: z.string().describe("현재 직급 및 직무"),
    exp_years: z.number().describe("총 경력 연차"),
    matched_projects: z.array(z.string()).optional().describe("조건에 부합하는 주요 프로젝트 명단")
  })),
  next_step_instructions: z.string().describe("Insight-Seeker가 이 후보자들의 어떤 로그를 중점적으로 봐야 하는지 지시사항")
});

const TheInsightSeekerSchema = z.object({
  candidate_analyses: z.array(z.object({
    id: z.string().describe("후보자 ID"),
    technical_depth: z.string().describe("기술적 깊이 분석"),
    soft_skill_analysis: z.string().describe("소프트 스킬 분석"),
    evidence_quotes: z.array(z.string()).describe("증거 문구들")
  }))
});

const TheMatchmakerSchema = z.object({
  final_recommendation: z.array(z.object({
    rank: z.number().describe("순위"),
    name: z.string().describe("후보자 이름"),
    match_score: z.number().describe("매칭 점수 (0-100)"),
    summary_justification: z.string().describe("추천 사유 요약"),
    technical_proof: z.string().describe("기술적 증거"),
    collaboration_proof: z.string().describe("협업 증거")
  })),
  overall_conclusion: z.string().describe("전체 결론")
});

// Agent definitions
const theArchitect = new Agent({
  name: "The Architect",
  instructions: `[Role & Purpose]
너는 'Nexus HR' 솔루션의 전략 기획가인 The Architect이다. 너의 임무는 사용자의 인재 검색 요청을 분석하여, **'Fact-Finder(Graph Agent)'**와 **'Insight-Seeker(Vector Agent)'**가 각각 수행해야 할 최적의 검색 파라미터를 설계하는 것이다.

[Core Logic: 태스크 분할 원칙]
사용자의 요청을 다음 두 가지 관점으로 분리하여 기획하라.
정형 데이터 (Graph Search): 명확한 기술 스택(Kafka), 도메인(주문/결제), 프로젝트 참여 이력, 연차, 직급 등 '팩트'에 기반한 필터링.
비정형 데이터 (Vector Search): 특정 기술의 해결 깊이(Lag 최적화 등), 커뮤니케이션 스타일, 문제 해결 태도, 문서화 능력 등 '맥락'에 기반한 심층 검색.

[Constraints & Rules]
카프카(Kafka) 요청 시, 반드시 'Consumer Lag', 'Partitioning', 'Throughput' 등 전문 용어를 Vector Search 키워드에 포함시켜 기술적 깊이를 검증하라.
주문(Order) 도메인 요청 시, '트랜잭션 정합성', '상태 머신', '멱등성' 관련 키워드를 포함하라.
사용자가 구체적으로 명시하지 않았더라도, 해당 직무에 필요한 암묵적 역량을 유추하여 검색 전략에 포함하라.
`,
  model: "gpt-4.1",
  outputType: TheArchitectSchema,
  modelSettings: {
    temperature: 1,
    topP: 1,
    maxTokens: 2048,
    store: true
  }
});

const theFactFinder = new Agent({
  name: "The Fact-Finder",
  instructions: `[Role]
너는 'Nexus HR'의 데이터베이스 전문가 The Fact-Finder이다. 너의 주 업무는 입력을 바탕으로 최적의 Neo4j Cypher 쿼리를 생성하여 후보자 명단을 추출하는 것이다.
[Knowledge: DB Schema]
너는 다음의 그래프 구조를 완벽히 숙지하고 있다.
Nodes: Employee (name, exp_years, position, id), Skill (name), Project (name), Domain (name)
Relationships:
(Employee)-[:HAS_SKILL]->(Skill)
(Employee)-[:WORKED_ON]->(Project)
(Project)-[:IN_DOMAIN]->(Domain)
[Knowledge: 검색 키워드 규칙]
- Position 검색: "Senior", "Middle", "Junior", "Backend", "Frontend" (toLower()를 사용하고 영어 키워드로 검색)
- Skill name 검색: "Kafka", "Java", "Spring Boot" (대소문자를 정확히 지켜라)
- Domain name 검색: "주문", "결제", "배송" (한글 이름을 사용하라)
[Task]
Architect가 제공한 graph_filter JSON을 분석하라.
위 스키마와 검색 키워드 규칙을 바탕으로 Employee를 필터링하는 Cypher 쿼리를 작성하고 executeCypherQuery 툴을 즉시 호출하여 쿼리를 실행해 결과를 반환하라.
연차 필터링: min_experience가 "3년"처럼 문자열로 들어오면 숫자 3만 추출하여 e.exp_years >= 3으로 처리하라.
결과 제한: 후보자가 너무 많을 경우를 대비해 상위 5명만 리턴하도록 LIMIT 5를 사용하라.`,
  model: "gpt-4.1",
  outputType: TheFactFinderSchema,
  tools: [executeCypherQuery],
  modelSettings: {
    temperature: 1,
    topP: 1,
    parallelToolCalls: true,
    maxTokens: 2048,
    store: true
  }
});

const theInsightSeeker = new Agent({
  name: "The Insight-Seeker",
  instructions: `[Role]
너는 인재의 실무 역량을 심층 분석하는 The Insight-Seeker이다.
[Task]
Fact-Finder가 선정한 후보자의 ID와 Architect가 제안한 검색 키워드를 받아 벡터 DB를 조회하라.
단순히 기술 이름이 언급된 곳이 아니라, 문제 해결 과정이나 논리적 근거가 드러난 기록을 우선적으로 찾아라.
찾은 내용을 바탕으로 해당 후보자가 왜 이 프로젝트에 적합한지(혹은 부적합한지) 구체적인 '증거 문구'와 함께 요약하라.

[Tool Usage Strategy]
Fact-Finder에게 받은 후보자 ID 리스트를 candidate_ids 파라미터에 전달하라.
Architect가 설계한 vector_search 키워드들을 query_keywords에 전달하라.
툴로부터 결과(로그)를 받으면, 각 로그의 내용이 후보자의 기술적 깊이를 나타내는지, 아니면 협업 스타일을 나타내는지 분류하여 분석하라.
만약 특정 후보자의 로그가 검색되지 않는다면, "해당 후보자에 대한 구체적인 실무 기록을 찾을 수 없음"이라고 명시하라.`,
  model: "gpt-4.1",
  outputType: TheInsightSeekerSchema,
  tools: [searchActivityLogs],
  modelSettings: {
    temperature: 1,
    topP: 1,
    parallelToolCalls: true,
    maxTokens: 2048,
    store: true
  }
});

const theMatchmaker = new Agent({
  name: "The Matchmaker",
  instructions: `[Role]
너는 'Nexus HR'의 최종 의사결정 지원 에이전트인 The Matchmaker이다. 너의 임무는 Fact-Finder(정형 데이터)와 Insight-Seeker(비정형 데이터)의 분석 결과를 종합하여 최적의 인재 추천 리포트를 작성하는 것이다.
너는 분석의 마지막 단계다. 너의 입력값은 항상 아래 3가지 요소를 포함한 JSON 형태로 들어올 것이다.
original_intent: 사용자의 초기 요구사항
graph_facts: DB에서 확인된 정형 경력 데이터
vector_insights: 활동 로그에서 추출된 비정형 실무 역량 이 세 데이터를 대조하여 모순이 없는지 확인하고 최종 매칭 점수를 산출하라.

[Task]
데이터 대조: Fact-Finder가 확인한 경력/기술 스택이 Insight-Seeker가 찾아낸 실제 업무 로그(코드, 대화)와 일치하는지 검증하라.
가중치 기반 평가: 아래 기준에 따라 match_score (0~100)를 산출하라.
기술 스택 및 도메인 적합성 (40%)
실제 문제 해결 증거(Evidence)의 구체성 (40%)
커뮤니케이션 및 협업 스타일 적합도 (20%)
증거 중심 서술: "잘함"과 같은 모호한 표현 대신, Insight-Seeker가 찾은 **실제 증거 문구(Evidence Quotes)**를 인용하여 추천 사유를 작성하라.
[Constraint]
결과가 여러 명일 경우 match_score가 높은 순으로 정렬하라.
만약 그래프상 경력은 화려하지만 벡터 로그에서 구체적인 실무 증거가 발견되지 않는다면, 점수를 냉정하게 낮게 책정하라.
최종 출력은 반드시 정의된 JSON Schema 형식을 엄격히 준수하라.
[Tone & Manner]
전문적이고 객관적이며 인사이트가 넘치는 톤을 유지하라.
팀장이 이 리포트만 보고도 바로 면접 여부를 결정할 수 있을 만큼 구체적이어야 한다.`,
  model: "gpt-4.1",
  outputType: TheMatchmakerSchema,
  modelSettings: {
    temperature: 1,
    topP: 1,
    maxTokens: 2048,
    store: true
  }
});

type WorkflowInput = { input_as_text: string };

// Main code entrypoint
export const runWorkflow = async (workflow: WorkflowInput) => {
  return await withTrace("Nexus HR", async () => {
    const conversationHistory: AgentInputItem[] = [
      { role: "user", content: [{ type: "input_text", text: workflow.input_as_text }] }
    ];
    const runner = new Runner({
      traceMetadata: {
        __trace_source__: "agent-builder",
        workflow_id: "wf_696d061bb4d881908c8375143f1b804c0dab1310994363e4"
      }
    });

    // 1. The Architect
    const theArchitectResultTemp = await runner.run(theArchitect, [...conversationHistory]);
    conversationHistory.push(...theArchitectResultTemp.newItems.map((item) => item.rawItem));
    if (!theArchitectResultTemp.finalOutput) {
      throw new Error("Architect result is undefined");
    }
    const theArchitectResult = {
      output_text: JSON.stringify(theArchitectResultTemp.finalOutput),
      output_parsed: theArchitectResultTemp.finalOutput
    };

    // 2. The Fact-Finder
    const theFactFinderResultTemp = await runner.run(theFactFinder, [...conversationHistory]);
    conversationHistory.push(...theFactFinderResultTemp.newItems.map((item) => item.rawItem));
    if (!theFactFinderResultTemp.finalOutput) {
      throw new Error("Fact-Finder result is undefined");
    }
    const theFactFinderResult = {
      output_text: JSON.stringify(theFactFinderResultTemp.finalOutput),
      output_parsed: theFactFinderResultTemp.finalOutput
    };

    // 3. The Insight-Seeker
    const theInsightSeekerResultTemp = await runner.run(theInsightSeeker, [...conversationHistory]);
    conversationHistory.push(...theInsightSeekerResultTemp.newItems.map((item) => item.rawItem));
    if (!theInsightSeekerResultTemp.finalOutput) {
      throw new Error("Insight-Seeker result is undefined");
    }
    const theInsightSeekerResult = {
      output_text: JSON.stringify(theInsightSeekerResultTemp.finalOutput),
      output_parsed: theInsightSeekerResultTemp.finalOutput
    };

    // 4. The Matchmaker
    const theMatchmakerResultTemp = await runner.run(theMatchmaker, [...conversationHistory]);
    conversationHistory.push(...theMatchmakerResultTemp.newItems.map((item) => item.rawItem));
    if (!theMatchmakerResultTemp.finalOutput) {
      throw new Error("Matchmaker result is undefined");
    }
    const theMatchmakerResult = {
      output_text: JSON.stringify(theMatchmakerResultTemp.finalOutput),
      output_parsed: theMatchmakerResultTemp.finalOutput
    };

    return {
      architect: theArchitectResult,
      factFinder: theFactFinderResult,
      insightSeeker: theInsightSeekerResult,
      matchmaker: theMatchmakerResult
    };
  });
}

// 직접 실행 시 테스트
runWorkflow({
  input_as_text: "카프카 경험이 있고 주문 도메인 경험이 있는 경력 3년 이상 백엔드 개발자를 찾아줘"
}).then((result) => {
  console.log("Workflow completed:", JSON.stringify(result, null, 2));
}).catch((error) => {
  console.error("Workflow error:", error);
}).finally(async () => {
  await closeDriver();
});
