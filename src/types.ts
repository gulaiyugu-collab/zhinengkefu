/**
 * 类型定义
 */

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

// ===== 客服业务扩展类型 =====

/** 会话状态：AI 处理中 / 已转人工待接单 / 人工处理中 / 已解决 */
export type SessionStatus = 'pending' | 'escalated' | 'agent_handling' | 'resolved';

/** 用户意图 */
export type Intent = 'refund' | 'order_query' | 'tech_support' | 'escalate' | 'other';

/** FAQ 分类 */
export type FaqCategory = 'profile' | 'service' | 'case' | 'pricing' | 'process' | 'boundary' | 'refund' | 'order_query' | 'tech_support' | 'general';

/** 转人工工单状态 */
export type EscalationStatus = 'pending' | 'taken' | 'resolved';

export interface Model {
  modelId: string;
  name: string;
  description?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input?: Record<string, unknown>;
  status: 'running' | 'completed' | 'error';
  result?: string;
  isError?: boolean;
}

/**
 * 内容块类型 - 支持文字和工具调用按顺序排列
 */
export type ContentBlock = 
  | { type: 'text'; text: string }
  | { type: 'tool_use'; toolCall: ToolCall };

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;  // 保留用于兼容，存储纯文本摘要
  model?: string;
  timestamp: Date;
  isStreaming?: boolean;
  toolCalls?: ToolCall[];  // 保留用于兼容
  contentBlocks?: ContentBlock[];  // 新增：按顺序排列的内容块
  sender?: 'ai' | 'human' | 'system' | 'user';  // 消息发送者（区分 AI 与人工客服）
}

export interface Session {
  id: string;
  title: string;
  model: string;
  agentId?: string;
  cwd?: string;
  permissionMode?: PermissionMode;
  createdAt: Date;
  messages: Message[];
  // 客服业务扩展字段
  status?: SessionStatus;
  intent?: Intent;
  handledBy?: string;
}

/** FAQ 知识库条目 */
export interface FAQ {
  id: string;
  category: FaqCategory;
  question: string;
  answer: string;
  keywords: string;
  createdAt: string;
  updatedAt: string;
}

/** FAQ 检索结果（带相关性得分） */
export interface FaqSearchResult extends FAQ {
  score: number;
}

/** 转人工工单 */
export interface Escalation {
  id: string;
  sessionId: string;
  reason: string;
  intent: Intent | null;
  status: EscalationStatus;
  agentId: string | null;
  createdAt: string;
  takenAt: string | null;
  resolvedAt: string | null;
}

/** 满意度评分 */
export interface Rating {
  id: string;
  sessionId: string;
  score: number;  // 1-5
  comment: string | null;
  createdAt: string;
}

/** 模拟订单 */
export interface Order {
  id: string;
  customerName: string;
  status: 'pending' | 'shipped' | 'delivered' | 'cancelled' | 'refunded';
  totalAmount: number;
  items: Array<{ name: string; qty: number; price: number }>;
  createdAt: string;
  updatedAt: string;
}

/** 管理后台会话列表行（带统计） */
export interface AdminSessionRow {
  id: string;
  title: string;
  model: string;
  status: SessionStatus;
  intent: Intent | null;
  handledBy: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  ratingScore: number | null;
  ratingComment: string | null;
  escalationId: string | null;
  escalationReason: string | null;
  escalationStatus: EscalationStatus | null;
}

/** 满意度统计 */
export interface RatingStats {
  totalSessions: number;
  resolvedSessions: number;
  escalatedSessions: number;
  pendingSessions: number;
  avgRating: number | null;
  ratingDistribution: { [key: string]: number };
  intentDistribution: { [key: string]: number };
  escalationRate: number;
}

/** 私人客服线索 */
export interface Lead {
  id: string;
  sessionId: string;
  name: string | null;
  contact: string | null;
  channel: string | null;
  need: string;
  budget: string | null;
  timeline: string | null;
  priority: 'low' | 'medium' | 'high' | string;
  status: 'new' | 'contacted' | 'qualified' | 'closed' | string;
  summary: string;
  sourceMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomAgent {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  icon?: string;
  color?: string;
  permissionMode?: PermissionMode;
  createdAt: Date;
  updatedAt: Date;
}

// Agent 是 CustomAgent 的别名
export type Agent = CustomAgent;

export type Theme = 'light' | 'dark';

/**
 * 权限请求 - 用于工具调用确认
 */
export interface PermissionRequest {
  requestId: string;
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  sessionId: string;
  timestamp: number;
}

/**
 * 权限响应
 */
export interface PermissionResponse {
  requestId: string;
  behavior: 'allow' | 'deny';
  message?: string;
}
