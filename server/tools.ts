/**
 * 智能客服 MCP 工具定义
 *
 * 四个工具：
 * 1. search_faq - 检索 FAQ 知识库（FTS5 全文检索）
 * 2. escalate_to_human - 转人工客服（需要 sessionId 上下文）
 * 3. query_order - 查询订单状态
 * 4. capture_lead - 沉淀合作/项目咨询线索
 *
 * 关键设计：escalate_to_human 需要 sessionId 上下文，因此 createCsMcpServer 设计为工厂函数。
 */

import { createSdkMcpServer, tool } from '@tencent-ai/agent-sdk';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';

// ============= 工具 1：搜索 FAQ 知识库 =============
const toToolText = (data: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    },
  ],
});

const searchFaqTool = tool(
  'search_faq',
  '搜索私人客服知识库，根据用户问题检索个人介绍、服务范围、项目案例、报价边界、交付流程、FAQ 等资料。回答咨询前应优先调用此工具获取可信资料。',
  {
    query: z.string().describe('用户的搜索关键词或问题'),
    category: z.enum(['profile', 'service', 'case', 'pricing', 'process', 'boundary', 'refund', 'order_query', 'tech_support', 'general']).optional()
      .describe('限定搜索的资料类别，不传则搜索全部'),
  },
  async ({ query, category }) => {
    const results = db.searchFaqs(query, category, 5);
    if (results.length === 0) {
      return toToolText({
        found: false,
        message: '未在 FAQ 知识库中找到相关内容，建议转人工处理',
        results: [],
      });
    }
    return toToolText({
      found: true,
      count: results.length,
      results: results.map(r => ({
        id: r.id,
        question: r.question,
        answer: r.answer,
        category: r.category,
        keywords: r.keywords,
        score: r.score,
      })),
    });
  }
);

// ============= 工具 2：查询订单 =============
const queryOrderTool = tool(
  'query_order',
  '根据订单号查询订单状态和详情。当用户询问订单状态、物流信息、提供订单号时调用。',
  {
    order_id: z.string().describe('订单编号'),
  },
  async ({ order_id }) => {
    const order = db.getOrderById(order_id);
    if (!order) {
      return toToolText({
        found: false,
        message: `未找到订单 ${order_id}，请确认订单号是否正确`,
      });
    }
    return toToolText({
      found: true,
      order: {
        id: order.id,
        customer_name: order.customer_name,
        status: order.status,
        total_amount: order.total_amount,
        items: JSON.parse(order.items),
        created_at: order.created_at,
        updated_at: order.updated_at,
      },
    });
  }
);

// ============= 工具 3：转人工（工厂函数，需要 sessionId 上下文） =============

/**
 * 创建客服 MCP Server（按会话隔离）
 *
 * escalate_to_human 工具需要知道当前会话 ID 才能创建对应的工单，
 * 因此整个 MCP Server 设计为按会话创建的工厂函数。
 *
 * search_faq 和 query_order 不依赖 sessionId，但为简化实现也一并放入工厂。
 */
export function createCsMcpServer(sessionId: string) {
  const captureLeadWithSession = tool(
    'capture_lead',
    '把有合作意向、项目咨询、报价咨询、定制开发、内容生产、自动化搭建等对话沉淀为待跟进线索。用户表达明确需求或留下联系方式时调用。',
    {
      need: z.string().describe('用户想解决的问题或项目需求，必须具体'),
      summary: z.string().describe('线索摘要，帮助本人快速判断是否值得跟进'),
      name: z.string().optional().describe('用户称呼或公司名，未知可不传'),
      contact: z.string().optional().describe('用户主动提供的联系方式，不能编造'),
      channel: z.string().optional().describe('来源渠道，如网站、微信、飞书、朋友介绍等，未知可不传'),
      budget: z.string().optional().describe('用户预算或价格范围，未知可不传'),
      timeline: z.string().optional().describe('期望交付时间或紧急程度，未知可不传'),
      priority: z.enum(['low', 'medium', 'high']).optional().describe('跟进优先级，高价值/明确预算/紧急需求可标 high'),
      source_message: z.string().optional().describe('触发线索的用户原话摘要'),
    },
    async ({ need, summary, name, contact, channel, budget, timeline, priority, source_message }) => {
      const leadId = uuidv4();
      const now = new Date().toISOString();

      db.createLead({
        id: leadId,
        session_id: sessionId,
        name: name || null,
        contact: contact || null,
        channel: channel || 'chat',
        need,
        budget: budget || null,
        timeline: timeline || null,
        priority: priority || 'medium',
        status: 'new',
        summary,
        source_message: source_message || null,
        created_at: now,
        updated_at: now,
      });

      return toToolText({
        success: true,
        message: '已记录为待跟进线索',
        leadId,
      });
    }
  );

  const escalateWithSession = tool(
    'escalate_to_human',
    '将当前对话转接给人工客服。当 FAQ 无法解决用户问题、用户明确要求人工、或问题超出自动处理范围时调用此工具。调用后 AI 不再继续回复，应向用户说明已转人工。',
    {
      reason: z.string().describe('转人工的原因，需具体说明（如：FAQ 未找到相关答案 / 用户明确要求人工 / 退款金额超限 等）'),
      intent: z.enum(['refund', 'order_query', 'tech_support', 'escalate', 'other'])
        .describe('识别到的用户意图'),
      summary: z.string().optional().describe('对话摘要，帮助人工客服快速了解上下文'),
    },
    async ({ reason, intent, summary }) => {
      const escalationId = uuidv4();
      const now = new Date().toISOString();

      // 事务：创建工单 + 更新会话状态
      db.createEscalation({
        id: escalationId,
        session_id: sessionId,
        reason: summary ? `${reason}（摘要：${summary}）` : reason,
        intent,
        status: 'pending',
        agent_id: null,
        created_at: now,
        taken_at: null,
        resolved_at: null,
      });

      db.updateSession(sessionId, { status: 'escalated', intent });

      return toToolText({
        success: true,
        message: '已成功转接人工客服，工单已创建，客服人员将尽快为您服务',
        escalationId,
      });
    }
  );

  return createSdkMcpServer({
    name: 'cs-tools',
    version: '1.0.0',
    tools: [searchFaqTool, captureLeadWithSession, escalateWithSession, queryOrderTool],
  });
}
