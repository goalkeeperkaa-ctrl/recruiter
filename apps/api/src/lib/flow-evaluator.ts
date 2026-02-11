import type {
  FlowDefinition,
  FlowEdge,
  FlowEdgeCondition,
  FlowScoreCondition,
  ScoringRules,
} from "./flow-definition.js";

export interface SavedAnswer {
  nodeKey: string;
  questionId: string;
  questionText: string;
  value: unknown;
}

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

function answersByQuestion(answers: SavedAnswer[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const answer of answers) {
    out.set(answer.questionId, answer.value);
  }
  return out;
}

export function requiredQuestionIds(flow: FlowDefinition): string[] {
  const out = new Set<string>();

  for (const node of flow.nodes) {
    if (node.type === "screening" || node.type === "test") {
      for (const question of node.config.questions ?? []) {
        if (question.required) {
          out.add(question.id);
        }
      }
    }

    if (node.type === "form") {
      for (const field of node.config.fields ?? []) {
        if (field.required) {
          out.add(field.id);
        }
      }
    }

    if (node.type === "consent" && node.config.required) {
      out.add("consent_accepted");
    }
  }

  return [...out.values()];
}

export function scoreAnswers(flow: FlowDefinition, answers: SavedAnswer[]): {
  scoreTotal: number;
  scoreBreakdown: Record<string, number>;
} {
  const questionToConfig = new Map<string, { scoring?: Record<string, number>; correct?: string; score?: number }>();

  for (const node of flow.nodes) {
    for (const question of node.config.questions ?? []) {
      questionToConfig.set(question.id, {
        scoring: question.scoring,
        correct: question.correct,
        score: question.score,
      });
    }
  }

  let total = 0;
  const breakdown: Record<string, number> = {};

  for (const answer of answers) {
    if (answer.questionId === "consent_accepted") {
      breakdown[answer.questionId] = 0;
      continue;
    }

    const config = questionToConfig.get(answer.questionId);
    if (!config) {
      breakdown[answer.questionId] = 0;
      continue;
    }

    let points = 0;

    if (config.scoring) {
      if (Array.isArray(answer.value)) {
        points = answer.value
          .map((entry) => config.scoring?.[String(entry)] ?? 0)
          .reduce((acc, item) => acc + item, 0);
      } else {
        points = config.scoring[String(answer.value)] ?? 0;
      }
    } else if (config.correct && config.score) {
      points = String(answer.value) === config.correct ? config.score : 0;
    }

    breakdown[answer.questionId] = points;
    total += points;
  }

  return {
    scoreTotal: total,
    scoreBreakdown: breakdown,
  };
}

export function missingRequired(flow: FlowDefinition, answers: SavedAnswer[]): string[] {
  const required = requiredQuestionIds(flow);
  const byQuestion = answersByQuestion(answers);

  return required.filter((id) => {
    const value = byQuestion.get(id);
    return !isFilled(value);
  });
}

function matchScore(scoreTotal: number, condition: FlowScoreCondition): boolean {
  if (condition[">="] !== undefined && !(scoreTotal >= condition[">="])) {
    return false;
  }
  if (condition[">"] !== undefined && !(scoreTotal > condition[">"])) {
    return false;
  }
  if (condition["<="] !== undefined && !(scoreTotal <= condition["<="])) {
    return false;
  }
  if (condition["<"] !== undefined && !(scoreTotal < condition["<"])) {
    return false;
  }
  if (condition.between) {
    const [min, max] = condition.between;
    if (scoreTotal < min || scoreTotal > max) {
      return false;
    }
  }
  return true;
}

function matchAnswers(submittedAnswers: Map<string, unknown>, conditionAnswers: Record<string, unknown>): boolean {
  for (const [questionId, expected] of Object.entries(conditionAnswers)) {
    const actual = submittedAnswers.get(questionId);

    if (typeof expected === "object" && expected !== null && "in" in expected) {
      const set = (expected as { in: unknown[] }).in;
      if (!Array.isArray(set) || !set.includes(actual)) {
        return false;
      }
      continue;
    }

    if (Array.isArray(actual)) {
      if (!actual.includes(expected)) {
        return false;
      }
      continue;
    }

    if (actual !== expected) {
      return false;
    }
  }

  return true;
}

function matchCondition(scoreTotal: number, submittedAnswers: Map<string, unknown>, condition?: FlowEdgeCondition): boolean {
  if (!condition) {
    return true;
  }

  if (condition.score_total && !matchScore(scoreTotal, condition.score_total)) {
    return false;
  }

  if (condition.answers && !matchAnswers(submittedAnswers, condition.answers)) {
    return false;
  }

  return true;
}

export function resolveNextNode(
  flow: FlowDefinition,
  currentNodeKey: string,
  answers: SavedAnswer[],
  scoreTotal: number,
): string | null {
  const byQuestion = answersByQuestion(answers);
  const candidates = (flow.edges ?? [])
    .filter((edge) => edge.from === currentNodeKey)
    .sort((a: FlowEdge, b: FlowEdge) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const edge of candidates) {
    if (matchCondition(scoreTotal, byQuestion, edge.condition)) {
      return edge.to;
    }
  }

  return null;
}

export function resolveOutcome(scoreTotal: number, scoringRules: ScoringRules): {
  status: string;
  stage: string;
} {
  const pass = scoringRules.pass_threshold ?? 70;
  const reserve = scoringRules.reserve_threshold ?? 55;

  if (scoreTotal >= pass) {
    return { status: "screening", stage: "Pass" };
  }

  if (scoreTotal >= reserve) {
    return { status: "reserve", stage: "Reserve" };
  }

  return { status: "rejected", stage: "Reject" };
}
