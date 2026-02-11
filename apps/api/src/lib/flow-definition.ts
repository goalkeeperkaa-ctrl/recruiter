export interface FlowQuestion {
  id: string;
  text: string;
  required?: boolean;
  scoring?: Record<string, number>;
  correct?: string;
  score?: number;
}

export interface FlowField {
  id: string;
  label: string;
  required?: boolean;
}

export interface FlowNode {
  key: string;
  type: string;
  config: {
    questions?: FlowQuestion[];
    fields?: FlowField[];
    required?: boolean;
    [key: string]: unknown;
  };
}

export interface FlowScoreCondition {
  ">="?: number;
  ">"?: number;
  "<="?: number;
  "<"?: number;
  between?: [number, number];
}

export interface FlowEdgeCondition {
  score_total?: FlowScoreCondition;
  answers?: Record<string, unknown>;
}

export interface FlowEdge {
  from: string;
  to: string;
  condition?: FlowEdgeCondition;
  priority?: number;
}

export interface FlowDefinition {
  nodes: FlowNode[];
  edges?: FlowEdge[];
}

export interface ScoringRules {
  pass_threshold?: number;
  reserve_threshold?: number;
  reject_threshold?: number;
}

export function defaultFlowDefinition(): FlowDefinition {
  return {
    nodes: [
      {
        key: "intro",
        type: "intro",
        config: {},
      },
      {
        key: "screening",
        type: "screening",
        config: {
          questions: [
            {
              id: "q_city",
              text: "Ваш город/часовой пояс?",
              required: true,
              scoring: {
                MSK: 5,
                "UTC+3": 5,
                "UTC+1": 3,
                "Другое": 1,
              },
            },
          ],
        },
      },
      {
        key: "form",
        type: "form",
        config: {
          fields: [
            { id: "full_name", label: "Имя и фамилия", required: true },
            { id: "phone", label: "Телефон", required: true },
            { id: "email", label: "Email", required: false },
          ],
        },
      },
      {
        key: "consent",
        type: "consent",
        config: {
          required: true,
        },
      },
      {
        key: "end_pass",
        type: "end",
        config: {},
      },
      {
        key: "end_reserve",
        type: "end",
        config: {},
      },
      {
        key: "end_reject",
        type: "end",
        config: {},
      },
    ],
    edges: [
      { from: "intro", to: "screening" },
      { from: "screening", to: "form" },
      { from: "form", to: "consent" },
      {
        from: "consent",
        to: "end_pass",
        condition: { score_total: { ">=": 70 } },
        priority: 10,
      },
      {
        from: "consent",
        to: "end_reserve",
        condition: { score_total: { between: [55, 69] } },
        priority: 5,
      },
      {
        from: "consent",
        to: "end_reject",
        condition: { score_total: { "<": 55 } },
        priority: 0,
      },
    ],
  };
}

export function defaultScoringRules(): Required<ScoringRules> {
  return {
    pass_threshold: 70,
    reserve_threshold: 55,
    reject_threshold: 0,
  };
}
