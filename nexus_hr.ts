import { z } from "zod";
import { Agent, AgentInputItem, Runner, withTrace } from "@openai/agents";

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
    return theArchitectResult;
  });
}

// 직접 실행 시 테스트
runWorkflow({
  input_as_text: "카프카 경험이 있고 주문 도메인에서 3년 이상 일한 시니어 백엔드 개발자를 찾아줘"
}).then((result) => {
  console.log("Workflow completed:", JSON.stringify(result, null, 2));
}).catch((error) => {
  console.error("Workflow error:", error);
});
