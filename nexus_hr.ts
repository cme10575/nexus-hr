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

const TheArchitectSchema = z.object({ reasoning: z.string(), graph_filter: z.object({ target_skills: z.array(z.string()), target_domain: z.string(), min_experience: z.string(), project_keywords: z.array(z.string()) }), vector_search: z.object({ technical_depth_keywords: z.array(z.string()), soft_skill_keywords: z.array(z.string()), evidence_to_find: z.string() }) });
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
  tools: [
    executeCypherQuery
  ],
  modelSettings: {
    temperature: 1,
    topP: 1,
    parallelToolCalls: true,
    maxTokens: 2048,
    store: true
  }
});

type WorkflowInput = { input_as_text: string };


// Main code entrypoint
export const runWorkflow = async (workflow: WorkflowInput) => {
  return await withTrace("Nexus HR", async () => {
    const state = {

    };
    const conversationHistory: AgentInputItem[] = [
      { role: "user", content: [{ type: "input_text", text: workflow.input_as_text }] }
    ];
    const runner = new Runner({
      traceMetadata: {
        __trace_source__: "agent-builder",
        workflow_id: "wf_696d061bb4d881908c8375143f1b804c0dab1310994363e4"
      }
    });
    const theArchitectResultTemp = await runner.run(
      theArchitect,
      [
        ...conversationHistory
      ]
    );
    conversationHistory.push(...theArchitectResultTemp.newItems.map((item) => item.rawItem));

    if (!theArchitectResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
    }

    const theArchitectResult = {
      output_text: JSON.stringify(theArchitectResultTemp.finalOutput),
      output_parsed: theArchitectResultTemp.finalOutput
    };

    const theFactFinderResultTemp = await runner.run(
      theFactFinder,
      [
        ...conversationHistory
      ]
    );
    conversationHistory.push(...theFactFinderResultTemp.newItems.map((item) => item.rawItem));

    if (!theFactFinderResultTemp.finalOutput) {
        throw new Error("Agent result is undefined");
    }

    const theFactFinderResult = {
      output_text: theFactFinderResultTemp.finalOutput ?? ""
    };

    return {
      architect: theArchitectResult,
      factFinder: theFactFinderResult
    };
  });
}

// 직접 실행 시 테스트
runWorkflow({
  input_as_text: "카프카 경험이 있고 주문 도메인에서 3년 이상 일한 시니어 백엔드 개발자를 찾아줘"
}).then((result) => {
  console.log("Workflow completed:", JSON.stringify(result, null, 2));
}).catch((error) => {
  console.error("Workflow error:", error);
}).finally(async () => {
  await closeDriver();
});
