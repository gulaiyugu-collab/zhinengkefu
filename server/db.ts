import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径
const dbPath = path.join(__dirname, '..', 'data', 'chat.db');

// 确保 data 目录存在
import fs from 'fs';
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 创建数据库连接
const db = new Database(dbPath);

// 启用 WAL 模式以提高性能
db.pragma('journal_mode = WAL');

// 初始化数据库表
db.exec(`
  -- 会话表
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    sdk_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 消息表
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    model TEXT,
    created_at TEXT NOT NULL,
    tool_calls TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  -- 为会话 ID 创建索引
  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

  -- ===== 客服业务扩展表 =====

  -- FAQ 知识库主表
  CREATE TABLE IF NOT EXISTS faqs (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    keywords TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- FTS5 全文检索虚拟表（better-sqlite3 ^12 默认启用 FTS5，Windows 无需额外配置）
  CREATE VIRTUAL TABLE IF NOT EXISTS faqs_fts USING fts5(
    question,
    answer,
    keywords,
    content='faqs',
    content_rowid='rowid',
    tokenize='unicode61'
  );

  -- 触发器：INSERT 时同步 FTS
  CREATE TRIGGER IF NOT EXISTS faqs_ai AFTER INSERT ON faqs BEGIN
    INSERT INTO faqs_fts(rowid, question, answer, keywords)
    VALUES (new.rowid, new.question, new.answer, new.keywords);
  END;

  -- 触发器：DELETE 时同步 FTS
  CREATE TRIGGER IF NOT EXISTS faqs_ad AFTER DELETE ON faqs BEGIN
    INSERT INTO faqs_fts(faqs_fts, rowid, question, answer, keywords)
    VALUES ('delete', old.rowid, old.question, old.answer, old.keywords);
  END;

  -- 触发器：UPDATE 时同步 FTS
  CREATE TRIGGER IF NOT EXISTS faqs_au AFTER UPDATE ON faqs BEGIN
    INSERT INTO faqs_fts(faqs_fts, rowid, question, answer, keywords)
    VALUES ('delete', old.rowid, old.question, old.answer, old.keywords);
    INSERT INTO faqs_fts(rowid, question, answer, keywords)
    VALUES (new.rowid, new.question, new.answer, new.keywords);
  END;

  -- 转人工工单表
  CREATE TABLE IF NOT EXISTS escalations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    intent TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    agent_id TEXT,
    created_at TEXT NOT NULL,
    taken_at TEXT,
    resolved_at TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations(status);
  CREATE INDEX IF NOT EXISTS idx_escalations_session ON escalations(session_id);

  -- 满意度评分表
  CREATE TABLE IF NOT EXISTS ratings (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
    comment TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_ratings_session ON ratings(session_id);

  -- 模拟订单表
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    status TEXT NOT NULL,
    total_amount REAL NOT NULL,
    items TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 私人客服线索表
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT,
    contact TEXT,
    channel TEXT,
    need TEXT NOT NULL,
    budget TEXT,
    timeline TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'new',
    summary TEXT NOT NULL,
    source_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_leads_session ON leads(session_id);
  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
`);

// ===== 数据库迁移：为现有表追加新列 =====

try {
  const sessionCols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!sessionCols.some(c => c.name === 'sdk_session_id')) {
    db.exec("ALTER TABLE sessions ADD COLUMN sdk_session_id TEXT");
    console.log("[DB] Added sdk_session_id column to sessions table");
  }
  if (!sessionCols.some(c => c.name === 'status')) {
    db.exec("ALTER TABLE sessions ADD COLUMN status TEXT DEFAULT 'pending'");
    console.log("[DB] Added status column to sessions table");
  }
  if (!sessionCols.some(c => c.name === 'intent')) {
    db.exec("ALTER TABLE sessions ADD COLUMN intent TEXT DEFAULT 'other'");
    console.log("[DB] Added intent column to sessions table");
  }
  if (!sessionCols.some(c => c.name === 'handled_by')) {
    db.exec("ALTER TABLE sessions ADD COLUMN handled_by TEXT");
    console.log("[DB] Added handled_by column to sessions table");
  }
} catch (e) {
  console.error("[DB] Migration error (sessions):", e);
}

try {
  const msgCols = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
  if (!msgCols.some(c => c.name === 'sender')) {
    db.exec("ALTER TABLE messages ADD COLUMN sender TEXT DEFAULT 'ai'");
    console.log("[DB] Added sender column to messages table");
  }
} catch (e) {
  console.error("[DB] Migration error (messages):", e);
}

// 类型定义
export interface DbSession {
  id: string;
  title: string;
  model: string;
  sdk_session_id: string | null;
  created_at: string;
  updated_at: string;
  // 客服业务扩展字段
  status?: string;        // pending / escalated / agent_handling / resolved
  intent?: string;        // refund / order_query / tech_support / escalate / other
  handled_by?: string | null;
}

export interface DbMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: string;
  tool_calls: string | null;
  sender?: string | null;  // ai / human / system / user
}

export interface DbFaq {
  id: string;
  category: string;       // refund / order_query / tech_support / general
  question: string;
  answer: string;
  keywords: string;
  created_at: string;
  updated_at: string;
}

export interface DbEscalation {
  id: string;
  session_id: string;
  reason: string;
  intent: string | null;
  status: string;         // pending / taken / resolved
  agent_id: string | null;
  created_at: string;
  taken_at: string | null;
  resolved_at: string | null;
}

export interface DbRating {
  id: string;
  session_id: string;
  score: number;
  comment: string | null;
  created_at: string;
}

export interface DbOrder {
  id: string;
  customer_name: string;
  status: string;         // pending / shipped / delivered / cancelled / refunded
  total_amount: number;
  items: string;          // JSON 字符串
  created_at: string;
  updated_at: string;
}

export interface DbLead {
  id: string;
  session_id: string;
  name: string | null;
  contact: string | null;
  channel: string | null;
  need: string;
  budget: string | null;
  timeline: string | null;
  priority: string;
  status: string;
  summary: string;
  source_message: string | null;
  created_at: string;
  updated_at: string;
}

// ============= 会话操作 =============

// 获取所有会话
export function getAllSessions(): DbSession[] {
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');
  return stmt.all() as DbSession[];
}

// 获取单个会话
export function getSession(id: string): DbSession | undefined {
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  return stmt.get(id) as DbSession | undefined;
}

// 创建会话
export function createSession(session: DbSession): DbSession {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, title, model, sdk_session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(session.id, session.title, session.model, session.sdk_session_id, session.created_at, session.updated_at);
  return session;
}

// 更新会话
export function updateSession(id: string, updates: Partial<Pick<DbSession, 'title' | 'model' | 'sdk_session_id' | 'status' | 'intent' | 'handled_by'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model);
  }
  if (updates.sdk_session_id !== undefined) {
    fields.push('sdk_session_id = ?');
    values.push(updates.sdk_session_id);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.intent !== undefined) {
    fields.push('intent = ?');
    values.push(updates.intent);
  }
  if (updates.handled_by !== undefined) {
    fields.push('handled_by = ?');
    values.push(updates.handled_by);
  }
  
  if (fields.length === 0) return false;
  
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  
  const stmt = db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// 删除会话
export function deleteSession(id: string): boolean {
  const stmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ============= 消息操作 =============

// 获取会话的所有消息
export function getMessagesBySession(sessionId: string): DbMessage[] {
  const stmt = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC');
  return stmt.all(sessionId) as DbMessage[];
}

// 创建消息
export function createMessage(message: DbMessage): DbMessage {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls, sender)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    message.id,
    message.session_id,
    message.role,
    message.content,
    message.model,
    message.created_at,
    message.tool_calls,
    message.sender || (message.role === 'user' ? 'user' : 'ai')
  );
  
  // 更新会话的 updated_at
  const updateStmt = db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
  updateStmt.run(new Date().toISOString(), message.session_id);
  
  return message;
}

// 更新消息内容
export function updateMessage(id: string, updates: Partial<Pick<DbMessage, 'content' | 'tool_calls'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content);
  }
  if (updates.tool_calls !== undefined) {
    fields.push('tool_calls = ?');
    values.push(updates.tool_calls);
  }
  
  if (fields.length === 0) return false;
  
  values.push(id);
  
  const stmt = db.prepare(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// 删除消息
export function deleteMessage(id: string): boolean {
  const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// 批量创建消息（用于保存对话）
export function createMessages(messages: DbMessage[]): void {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls, sender)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((msgs: DbMessage[]) => {
    for (const msg of msgs) {
      stmt.run(msg.id, msg.session_id, msg.role, msg.content, msg.model, msg.created_at, msg.tool_calls, msg.sender || (msg.role === 'user' ? 'user' : 'ai'));
    }
  });
  
  insertMany(messages);
}

// 清空所有数据
export function clearAllData(): void {
  db.exec('DELETE FROM leads');
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM sessions');
  db.exec('DELETE FROM faqs');
  db.exec('DELETE FROM escalations');
  db.exec('DELETE FROM ratings');
  db.exec('DELETE FROM orders');
}

// ============= FAQ 知识库操作 =============

// 获取所有 FAQ（支持按分类筛选）
export function getAllFaqs(category?: string): DbFaq[] {
  if (category) {
    const stmt = db.prepare('SELECT * FROM faqs WHERE category = ? ORDER BY updated_at DESC');
    return stmt.all(category) as DbFaq[];
  }
  const stmt = db.prepare('SELECT * FROM faqs ORDER BY updated_at DESC');
  return stmt.all() as DbFaq[];
}

// 获取单个 FAQ
export function getFaqById(id: string): DbFaq | undefined {
  const stmt = db.prepare('SELECT * FROM faqs WHERE id = ?');
  return stmt.get(id) as DbFaq | undefined;
}

// 创建 FAQ
export function createFaq(faq: DbFaq): DbFaq {
  const stmt = db.prepare(`
    INSERT INTO faqs (id, category, question, answer, keywords, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(faq.id, faq.category, faq.question, faq.answer, faq.keywords, faq.created_at, faq.updated_at);
  return faq;
}

// 批量创建 FAQ（用于种子数据注入）
export function createFaqsBatch(faqs: DbFaq[]): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO faqs (id, category, question, answer, keywords, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((items: DbFaq[]) => {
    for (const f of items) {
      stmt.run(f.id, f.category, f.question, f.answer, f.keywords, f.created_at, f.updated_at);
    }
  });
  insertMany(faqs);
}

// 更新 FAQ
export function updateFaq(id: string, updates: Partial<Pick<DbFaq, 'category' | 'question' | 'answer' | 'keywords'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }
  if (updates.question !== undefined) { fields.push('question = ?'); values.push(updates.question); }
  if (updates.answer !== undefined) { fields.push('answer = ?'); values.push(updates.answer); }
  if (updates.keywords !== undefined) { fields.push('keywords = ?'); values.push(updates.keywords); }
  
  if (fields.length === 0) return false;
  
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  
  const stmt = db.prepare(`UPDATE faqs SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// 删除 FAQ
export function deleteFaq(id: string): boolean {
  const stmt = db.prepare('DELETE FROM faqs WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// FTS5 全文检索（bm25 排序）
// 转义 FTS5 特殊字符：将每个词用双引号包裹，内部双引号转义为两个双引号
export function escapeFtsQuery(input: string): string {
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map(w => `"${w.replace(/"/g, '""')}"*`)
    .join(' OR ');
}

export interface FaqSearchResult extends DbFaq {
  score: number;  // bm25 得分（越小越相关，负数表示更相关）
}

// 全文检索 FAQ
export function searchFaqs(query: string, category?: string, limit: number = 5): FaqSearchResult[] {
  const ftsQuery = escapeFtsQuery(query);
  if (!ftsQuery) return [];
  
  let sql = `
    SELECT f.id, f.category, f.question, f.answer, f.keywords, f.created_at, f.updated_at,
           bm25(faqs_fts) AS score
    FROM faqs_fts
    JOIN faqs f ON f.rowid = faqs_fts.rowid
    WHERE faqs_fts MATCH ?
  `;
  const params: any[] = [ftsQuery];
  
  if (category) {
    sql += ` AND f.category = ?`;
    params.push(category);
  }
  
  sql += ` ORDER BY score LIMIT ?`;
  params.push(limit);
  
  const stmt = db.prepare(sql);
  return stmt.all(...params) as FaqSearchResult[];
}

// ============= 转人工工单操作 =============

export function createEscalation(esc: DbEscalation): DbEscalation {
  const stmt = db.prepare(`
    INSERT INTO escalations (id, session_id, reason, intent, status, agent_id, created_at, taken_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(esc.id, esc.session_id, esc.reason, esc.intent, esc.status, esc.agent_id, esc.created_at, esc.taken_at, esc.resolved_at);
  return esc;
}

export function getEscalationBySession(sessionId: string): DbEscalation | undefined {
  const stmt = db.prepare('SELECT * FROM escalations WHERE session_id = ? ORDER BY created_at DESC LIMIT 1');
  return stmt.get(sessionId) as DbEscalation | undefined;
}

export function getEscalationById(id: string): DbEscalation | undefined {
  const stmt = db.prepare('SELECT * FROM escalations WHERE id = ?');
  return stmt.get(id) as DbEscalation | undefined;
}

export function getEscalationsByStatus(status: string): DbEscalation[] {
  const stmt = db.prepare('SELECT * FROM escalations WHERE status = ? ORDER BY created_at DESC');
  return stmt.all(status) as DbEscalation[];
}

// 接管工单：更新工单状态 + 会话状态
export function takeEscalation(escalationId: string, agentId: string, sessionId: string): boolean {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE escalations SET status = 'taken', agent_id = ?, taken_at = ? WHERE id = ?`)
      .run(agentId, now, escalationId);
    db.prepare(`UPDATE sessions SET status = 'agent_handling', handled_by = ?, updated_at = ? WHERE id = ?`)
      .run(agentId, now, sessionId);
  });
  tx();
  return true;
}

// 标记工单已解决
export function resolveEscalation(escalationId: string, sessionId: string): boolean {
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE escalations SET status = 'resolved', resolved_at = ? WHERE id = ?`).run(now, escalationId);
    db.prepare(`UPDATE sessions SET status = 'resolved', updated_at = ? WHERE id = ?`).run(now, sessionId);
  });
  tx();
  return true;
}

// ============= 满意度评分操作 =============

export function createRating(rating: DbRating): DbRating {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO ratings (id, session_id, score, comment, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(rating.id, rating.session_id, rating.score, rating.comment, rating.created_at);
  return rating;
}

export function getRatingBySession(sessionId: string): DbRating | undefined {
  const stmt = db.prepare('SELECT * FROM ratings WHERE session_id = ?');
  return stmt.get(sessionId) as DbRating | undefined;
}

// 满意度统计
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

export function getRatingStats(): RatingStats {
  const countStmt = db.prepare('SELECT COUNT(*) as cnt FROM sessions');
  const totalSessions = (countStmt.get() as { cnt: number }).cnt;

  const statusStmt = db.prepare('SELECT status, COUNT(*) as cnt FROM sessions GROUP BY status');
  const statusRows = statusStmt.all() as Array<{ status: string; cnt: number }>;
  let resolvedSessions = 0, escalatedSessions = 0, pendingSessions = 0;
  for (const r of statusRows) {
    if (r.status === 'resolved') resolvedSessions = r.cnt;
    if (r.status === 'escalated' || r.status === 'agent_handling') escalatedSessions += r.cnt;
    if (r.status === 'pending') pendingSessions = r.cnt;
  }

  // 平均评分
  const avgStmt = db.prepare('SELECT AVG(score) as avg FROM ratings');
  const avgRow = avgStmt.get() as { avg: number | null };
  const avgRating = avgRow.avg;

  // 评分分布
  const distStmt = db.prepare('SELECT score, COUNT(*) as cnt FROM ratings GROUP BY score');
  const distRows = distStmt.all() as Array<{ score: number; cnt: number }>;
  const ratingDistribution: { [key: string]: number } = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const r of distRows) {
    ratingDistribution[String(r.score)] = r.cnt;
  }

  // 意图分布
  const intentStmt = db.prepare('SELECT intent, COUNT(*) as cnt FROM sessions GROUP BY intent');
  const intentRows = intentStmt.all() as Array<{ intent: string; cnt: number }>;
  const intentDistribution: { [key: string]: number } = {};
  for (const r of intentRows) {
    intentDistribution[r.intent || 'other'] = r.cnt;
  }

  const escalationRate = totalSessions > 0 ? escalatedSessions / totalSessions : 0;

  return {
    totalSessions,
    resolvedSessions,
    escalatedSessions,
    pendingSessions,
    avgRating,
    ratingDistribution,
    intentDistribution,
    escalationRate,
  };
}

// ============= 订单操作（模拟） =============

export function getOrderById(id: string): DbOrder | undefined {
  const stmt = db.prepare('SELECT * FROM orders WHERE id = ?');
  return stmt.get(id) as DbOrder | undefined;
}

export function getAllOrders(): DbOrder[] {
  const stmt = db.prepare('SELECT * FROM orders ORDER BY created_at DESC');
  return stmt.all() as DbOrder[];
}

// ============= 私人客服线索操作 =============

export function createLead(lead: DbLead): DbLead {
  const stmt = db.prepare(`
    INSERT INTO leads (
      id, session_id, name, contact, channel, need, budget, timeline,
      priority, status, summary, source_message, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    lead.id,
    lead.session_id,
    lead.name,
    lead.contact,
    lead.channel,
    lead.need,
    lead.budget,
    lead.timeline,
    lead.priority,
    lead.status,
    lead.summary,
    lead.source_message,
    lead.created_at,
    lead.updated_at
  );
  return lead;
}

export function getLeadById(id: string): DbLead | undefined {
  const stmt = db.prepare('SELECT * FROM leads WHERE id = ?');
  return stmt.get(id) as DbLead | undefined;
}

export function getLeads(filters: { status?: string; keyword?: string; page: number; pageSize: number }): { leads: DbLead[]; total: number } {
  const where: string[] = [];
  const params: any[] = [];

  if (filters.status) {
    where.push('status = ?');
    params.push(filters.status);
  }

  if (filters.keyword) {
    where.push('(name LIKE ? OR contact LIKE ? OR need LIKE ? OR summary LIKE ?)');
    const kw = `%${filters.keyword}%`;
    params.push(kw, kw, kw, kw);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (filters.page - 1) * filters.pageSize;
  const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM leads ${whereClause}`).get(...params) as { cnt: number };
  const leads = db.prepare(`
    SELECT * FROM leads
    ${whereClause}
    ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, filters.pageSize, offset) as DbLead[];

  return { leads, total: countRow.cnt };
}

export function updateLead(id: string, updates: Partial<Pick<DbLead, 'status' | 'priority' | 'summary'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.priority !== undefined) {
    fields.push('priority = ?');
    values.push(updates.priority);
  }
  if (updates.summary !== undefined) {
    fields.push('summary = ?');
    values.push(updates.summary);
  }

  if (fields.length === 0) return false;

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);

  const result = db.prepare(`UPDATE leads SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

export function createOrder(order: DbOrder): DbOrder {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO orders (id, customer_name, status, total_amount, items, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(order.id, order.customer_name, order.status, order.total_amount, order.items, order.created_at, order.updated_at);
  return order;
}

export function createOrdersBatch(orders: DbOrder[]): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO orders (id, customer_name, status, total_amount, items, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db.transaction((items: DbOrder[]) => {
    for (const o of items) {
      stmt.run(o.id, o.customer_name, o.status, o.total_amount, o.items, o.created_at, o.updated_at);
    }
  });
  insertMany(orders);
}

// ============= 管理后台查询 =============

export interface AdminSessionRow extends DbSession {
  message_count: number;
  rating_score: number | null;
  rating_comment: string | null;
  escalation_id: string | null;
  escalation_reason: string | null;
  escalation_status: string | null;
}

export function getAdminSessions(filters: { status?: string; intent?: string; keyword?: string; page: number; pageSize: number }): { sessions: AdminSessionRow[]; total: number } {
  const where: string[] = [];
  const params: any[] = [];

  if (filters.status) {
    where.push('s.status = ?');
    params.push(filters.status);
  }
  if (filters.intent) {
    where.push('s.intent = ?');
    params.push(filters.intent);
  }
  if (filters.keyword) {
    where.push('(s.title LIKE ? OR s.id LIKE ?)');
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (filters.page - 1) * filters.pageSize;

  // 总数
  const countSql = `SELECT COUNT(*) as cnt FROM sessions s ${whereClause}`;
  const countRow = db.prepare(countSql).get(...params) as { cnt: number };
  const total = countRow.cnt;

  // 列表
  const sql = `
    SELECT s.*,
           (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as message_count,
           r.score as rating_score,
           r.comment as rating_comment,
           e.id as escalation_id,
           e.reason as escalation_reason,
           e.status as escalation_status
    FROM sessions s
    LEFT JOIN ratings r ON r.session_id = s.id
    LEFT JOIN escalations e ON e.session_id = s.id AND e.id = (
      SELECT id FROM escalations WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1
    )
    ${whereClause}
    ORDER BY s.updated_at DESC
    LIMIT ? OFFSET ?
  `;
  const sessions = db.prepare(sql).all(...params, filters.pageSize, offset) as AdminSessionRow[];
  return { sessions, total };
}
