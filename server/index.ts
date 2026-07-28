import express from "express";
import { query, unstable_v2_createSession, unstable_v2_authenticate, PermissionResult, CanUseTool } from "@tencent-ai/agent-sdk";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import * as db from "./db.js";
import { CS_SYSTEM_PROMPT } from "./prompts.js";
import { createCsMcpServer } from "./tools.js";
import { seedData } from "./seed.js";

const execAsync = promisify(exec);

// 待处理的权限请求
interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  reject: (error: Error) => void;
  toolName: string;
  input: Record<string, unknown>;
  sessionId: string;
  timestamp: number;
}

const pendingPermissions = new Map<string, PendingPermission>();

// 权限请求超时时间（5分钟）
const PERMISSION_TIMEOUT = 5 * 60 * 1000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// 缓存可用模型列表
let cachedModels: Array<{ modelId: string; name: string; description?: string }> = [];
const defaultModel = "claude-sonnet-4";

// 健康检查
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 登录方式类型
type LoginMethod = 'env' | 'cli' | 'none';

interface LoginStatusResponse {
  isLoggedIn: boolean;
  method?: LoginMethod;
  envConfigured?: boolean;
  cliConfigured?: boolean;
  error?: string;
  apiKey?: string; // 脱敏后的 API Key
  envVars?: {
    apiKey?: string;
    authToken?: string;
    internetEnv?: string;
    baseUrl?: string;
  };
}

// 检查 CodeBuddy CLI 登录状态
app.get("/api/check-login", async (req, res) => {
  const response: LoginStatusResponse = {
    isLoggedIn: false,
    envConfigured: false,
    cliConfigured: false,
    envVars: {},
  };
  
  // 1. 检查环境变量
  const apiKey = process.env.CODEBUDDY_API_KEY;
  const authToken = process.env.CODEBUDDY_AUTH_TOKEN;
  const internetEnv = process.env.CODEBUDDY_INTERNET_ENVIRONMENT;
  const baseUrl = process.env.CODEBUDDY_BASE_URL;
  
  if (apiKey || authToken) {
    response.envConfigured = true;
    // 脱敏显示
    if (apiKey) {
      response.envVars!.apiKey = apiKey.slice(0, 8) + '****' + apiKey.slice(-4);
      response.apiKey = response.envVars!.apiKey;
    }
    if (authToken) {
      response.envVars!.authToken = authToken.slice(0, 8) + '****' + authToken.slice(-4);
    }
    if (internetEnv) {
      response.envVars!.internetEnv = internetEnv;
    }
    if (baseUrl) {
      response.envVars!.baseUrl = baseUrl;
    }
  }
  
  // 2. 使用 unstable_v2_authenticate 检查登录状态（更可靠）
  try {
    let needsLogin = false;
    
    const result = await unstable_v2_authenticate({
      environment: 'external',
      onAuthUrl: async (authState) => {
        // 如果执行到这个回调，说明未登录
        needsLogin = true;
        console.log('[Check Login] 需要登录，认证 URL:', authState.authUrl);
        // 将认证 URL 返回给前端（如果需要）
        response.error = '未登录，请先登录 CodeBuddy CLI';
      }
    });
    
    // 如果没有触发 onAuthUrl 回调，说明已登录
    if (!needsLogin && result?.userinfo) {
      response.isLoggedIn = true;
      response.cliConfigured = true;
      
      // 判断登录方式
      if (response.envConfigured) {
        response.method = 'env';
      } else {
        response.method = 'cli';
      }
      
      console.log('[Check Login] 已登录用户:', result.userinfo.userName);
    } else if (!needsLogin) {
      // result 存在但没有 userinfo，仍然认为已登录
      response.isLoggedIn = true;
      response.cliConfigured = true;
      response.method = response.envConfigured ? 'env' : 'cli';
    }
  } catch (error: any) {
    console.error("[Check Login] SDK Error:", error);
    
    // 如果有环境变量配置，仍然认为是登录状态
    if (response.envConfigured) {
      response.isLoggedIn = true;
      response.method = 'env';
    } else {
      response.error = error?.message || String(error);
      response.method = 'none';
    }
  }
  
  res.json(response);
});

// 保存环境变量配置
app.post("/api/save-env-config", (req, res) => {
  const { apiKey, authToken, internetEnv, baseUrl } = req.body;
  
  if (!apiKey && !authToken) {
    return res.status(400).json({ error: '请至少配置 API Key 或 Auth Token' });
  }
  
  const configuredVars: string[] = [];
  
  // 设置环境变量（仅在当前进程有效）
  if (apiKey) {
    process.env.CODEBUDDY_API_KEY = apiKey;
    configuredVars.push('CODEBUDDY_API_KEY');
  }
  if (authToken) {
    process.env.CODEBUDDY_AUTH_TOKEN = authToken;
    configuredVars.push('CODEBUDDY_AUTH_TOKEN');
  }
  if (internetEnv) {
    process.env.CODEBUDDY_INTERNET_ENVIRONMENT = internetEnv;
    configuredVars.push('CODEBUDDY_INTERNET_ENVIRONMENT');
  }
  if (baseUrl) {
    process.env.CODEBUDDY_BASE_URL = baseUrl;
    configuredVars.push('CODEBUDDY_BASE_URL');
  }
  
  // 清除模型缓存，以便重新获取
  cachedModels = [];
  
  res.json({ 
    success: true, 
    message: `已设置: ${configuredVars.join(', ')}`,
    note: '环境变量仅在当前服务器进程有效，重启后需要重新设置'
  });
});

// 获取可用模型列表
app.get("/api/models", async (req, res) => {
  try {
    if (cachedModels.length === 0) {
      console.log("[Models] Creating session to fetch available models...");
      
      const session = await unstable_v2_createSession({ 
        cwd: process.cwd()
      });
      
      console.log("[Models] Session created, calling getAvailableModels()...");
      const models = await session.getAvailableModels();
      console.log("[Models] Got", models.length, "models");
      
      if (models && Array.isArray(models)) {
        cachedModels = models;
      }
    }
    
    res.json({ 
      models: cachedModels.length > 0 ? cachedModels : [
        { modelId: "claude-sonnet-4", name: "Claude Sonnet 4" }
      ],
      defaultModel 
    });
  } catch (error: any) {
    console.error("[Models] Error:", error);
    res.json({
      models: [
        { modelId: "claude-sonnet-4", name: "Claude Sonnet 4" },
        { modelId: "claude-opus-4", name: "Claude Opus 4" }
      ],
      defaultModel,
      error: error?.message || String(error)
    });
  }
});

// ============= 会话 API =============

// 获取所有会话（包含消息数量）
app.get("/api/sessions", (req, res) => {
  try {
    const sessions = db.getAllSessions();
    const sessionsWithMessages = sessions.map(session => {
      const messages = db.getMessagesBySession(session.id);
      return {
        ...session,
        messageCount: messages.length
      };
    });
    res.json({ sessions: sessionsWithMessages });
  } catch (error: any) {
    console.error("[Sessions] Error:", error);
    res.status(500).json({ error: error?.message || "获取会话失败" });
  }
});

// 获取单个会话及其消息
app.get("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = db.getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: "会话不存在" });
    }
    
    const messages = db.getMessagesBySession(sessionId);
    
    // 解析 tool_calls JSON
    const parsedMessages = messages.map(msg => ({
      ...msg,
      tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : null
    }));
    
    res.json({ session, messages: parsedMessages });
  } catch (error: any) {
    console.error("[Session] Error:", error);
    res.status(500).json({ error: error?.message || "获取会话失败" });
  }
});

// 创建新会话
app.post("/api/sessions", (req, res) => {
  try {
    const { model = defaultModel, title = "新对话" } = req.body;
    const now = new Date().toISOString();
    
    const session = db.createSession({
      id: uuidv4(),
      title,
      model,
      sdk_session_id: null,
      created_at: now,
      updated_at: now
    });
    
    res.json({ session });
  } catch (error: any) {
    console.error("[Create Session] Error:", error);
    res.status(500).json({ error: error?.message || "创建会话失败" });
  }
});

// 更新会话
app.patch("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title, model } = req.body;
    
    const success = db.updateSession(sessionId, { title, model });
    
    if (!success) {
      return res.status(404).json({ error: "会话不存在" });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Update Session] Error:", error);
    res.status(500).json({ error: error?.message || "更新会话失败" });
  }
});

// 删除会话
app.delete("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const success = db.deleteSession(sessionId);
    
    if (!success) {
      return res.status(404).json({ error: "会话不存在" });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Delete Session] Error:", error);
    res.status(500).json({ error: error?.message || "删除会话失败" });
  }
});

// ============= 聊天 API =============

// 权限响应 API
app.post("/api/permission-response", (req, res) => {
  const { requestId, behavior, message } = req.body;
  
  console.log(`[Permission] Response received: requestId=${requestId}, behavior=${behavior}`);
  
  const pending = pendingPermissions.get(requestId);
  if (!pending) {
    console.log(`[Permission] Request not found: ${requestId}`);
    return res.status(404).json({ error: "权限请求不存在或已超时" });
  }
  
  // 清除请求
  pendingPermissions.delete(requestId);
  
  if (behavior === 'allow') {
    pending.resolve({
      behavior: 'allow',
      updatedInput: pending.input
    });
  } else {
    pending.resolve({
      behavior: 'deny',
      message: message || '用户拒绝了此操作'
    });
  }
  
  res.json({ success: true });
});

// 发送消息并获取流式响应
app.post("/api/chat", async (req, res) => {
  const { sessionId, message, model, systemPrompt, cwd, permissionMode } = req.body;
  
  // 请求日志
  console.log(`\n[Chat] ========== 新请求 ==========`);
  console.log(`[Chat] SessionId: ${sessionId}`);
  console.log(`[Chat] Model: ${model}`);
  console.log(`[Chat] Message: ${message?.slice(0, 100)}${message?.length > 100 ? '...' : ''}`);
  console.log(`[Chat] CWD: ${cwd || 'default'}`);

  if (!message) {
    console.log(`[Chat] 错误: 消息为空`);
    return res.status(400).json({ error: "消息不能为空" });
  }

  // 获取或创建会话
  let session = sessionId ? db.getSession(sessionId) : null;
  const now = new Date().toISOString();
  
  if (!session) {
    // 创建新会话
    console.log(`[Chat] 创建新会话`);
    session = db.createSession({
      id: sessionId || uuidv4(),
      title: message.slice(0, 30) + (message.length > 30 ? '...' : ''),
      model: model || defaultModel,
      sdk_session_id: null,  // 稍后从 SDK 获取
      created_at: now,
      updated_at: now
    });
  } else {
    console.log(`[Chat] 使用现有会话, SDK Session: ${session.sdk_session_id || 'none'}`);
  }

  const selectedModel = model || session.model;
  
  // 获取 SDK session ID（用于恢复对话）
  const sdkSessionId = session.sdk_session_id;

  // 创建用户消息 ID 和助手消息 ID
  const userMessageId = uuidv4();
  const assistantMessageId = uuidv4();

  // 保存用户消息到数据库
  try {
    db.createMessage({
      id: userMessageId,
      session_id: session.id,
      role: 'user',
      content: message,
      model: null,
      created_at: now,
      tool_calls: null
    });
    console.log(`[Chat] 用户消息已保存: ${userMessageId}`);
  } catch (dbError: any) {
    console.error(`[Chat] 保存用户消息失败:`, dbError);
    return res.status(500).json({ error: "保存消息失败", detail: dbError?.message });
  }

  // 设置 SSE 头
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // ===== 客服业务：转人工状态拦截 =====
  // 如果会话已转人工（escalated / agent_handling），AI 不再回复
  if (session.status === 'escalated' || session.status === 'agent_handling') {
    console.log(`[Chat] 会话已转人工 (status=${session.status})，AI 不回复`);
    res.write(`data: ${JSON.stringify({ 
      type: "init", 
      sessionId: session.id, 
      userMessageId, 
      assistantMessageId: uuidv4(),
      model: selectedModel 
    })}\n\n`);
    res.write(`data: ${JSON.stringify({ 
      type: "text", 
      content: "您当前已转接人工客服，请等待客服回复。如有其他问题，可直接在下方留言。" 
    })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "done", duration: 0, cost: 0 })}\n\n`);
    return res.end();
  }

  // 默认系统提示词 - 使用客服专属 prompt
  const defaultSystemPrompt = CS_SYSTEM_PROMPT;
  
  // 工作目录：优先使用请求中的 cwd，否则使用当前目录
  const workingDir = cwd || process.cwd();

  try {
    console.log(`[Chat] 调用 SDK query...`);
    console.log(`[Chat] - Model: ${selectedModel}`);
    console.log(`[Chat] - Resume: ${sdkSessionId || 'none'}`);
    console.log(`[Chat] - CWD: ${workingDir}`);
    console.log(`[Chat] - PermissionMode: ${permissionMode || 'default'}`);
    
    // 创建 canUseTool 回调
    const canUseTool: CanUseTool = async (toolName, input, options) => {
      console.log(`[Permission] Tool request: ${toolName}`);
      console.log(`[Permission] Input:`, JSON.stringify(input, null, 2));
      
      // bypassPermissions 模式直接放行
      if (permissionMode === 'bypassPermissions') {
        console.log(`[Permission] Bypassing permissions for ${toolName}`);
        return { behavior: 'allow', updatedInput: input };
      }
      
      // 创建权限请求
      const requestId = uuidv4();
      const permissionRequest = {
        requestId,
        toolUseId: options.toolUseID,
        toolName,
        input,
        sessionId: session.id,
        timestamp: Date.now()
      };
      
      // 发送权限请求到前端
      res.write(`data: ${JSON.stringify({ 
        type: "permission_request", 
        ...permissionRequest
      })}\n\n`);
      
      // 创建 Promise 等待用户响应
      return new Promise<PermissionResult>((resolve, reject) => {
        const pending: PendingPermission = {
          resolve,
          reject,
          toolName,
          input,
          sessionId: session.id,
          timestamp: Date.now()
        };
        
        pendingPermissions.set(requestId, pending);
        
        // 设置超时
        setTimeout(() => {
          if (pendingPermissions.has(requestId)) {
            pendingPermissions.delete(requestId);
            console.log(`[Permission] Request timeout: ${requestId}`);
            resolve({
              behavior: 'deny',
              message: '权限请求超时'
            });
          }
        }, PERMISSION_TIMEOUT);
      });
    };
    
    // 使用 Query API 发送消息
    // 如果有 sdk_session_id，使用 resume 恢复对话上下文
    // 注入客服 MCP 工具（search_faq / escalate_to_human / query_order）
    const csMcpServer = createCsMcpServer(session.id);
    const stream = query({
      prompt: message,
      options: {
        cwd: workingDir,
        model: selectedModel,
        maxTurns: 10,
        systemPrompt: systemPrompt || defaultSystemPrompt,
        permissionMode: permissionMode || 'default',
        canUseTool,
        mcpServers: {
          'cs-tools': csMcpServer,
        },
        ...(sdkSessionId ? { resume: sdkSessionId } : {})  // 使用 resume 恢复对话
      }
    });

    let fullResponse = "";
    let toolCalls: Array<{ 
      id: string; 
      name: string; 
      input?: Record<string, unknown>;
      status: string; 
      result?: string;
      isError?: boolean;
    }> = [];
    let newSdkSessionId: string | null = null;  // 用于存储 SDK 返回的 session_id

    // 发送会话ID和消息ID
    res.write(`data: ${JSON.stringify({ 
      type: "init", 
      sessionId: session.id, 
      userMessageId, 
      assistantMessageId,
      model: selectedModel 
    })}\n\n`);

    // 当前正在执行的工具 ID（用于匹配 tool_result）
    let currentToolId: string | null = null;

    // 处理流式响应
    for await (const msg of stream) {
      console.log("[Stream] Message type:", msg.type, msg);
      
      // 处理 system 消息，获取 SDK 的 session_id
      if (msg.type === "system" && (msg as any).subtype === "init") {
        newSdkSessionId = (msg as any).session_id;
        console.log(`[Stream] Got SDK session_id: ${newSdkSessionId}`);
        
        // 保存 SDK session_id 到数据库（如果是新的）
        if (newSdkSessionId && newSdkSessionId !== sdkSessionId) {
          db.updateSession(session.id, { sdk_session_id: newSdkSessionId });
          console.log(`[Stream] Saved SDK session_id to database`);
        }
      } else if (msg.type === "assistant") {
        const content = msg.message.content;

        if (typeof content === "string") {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ type: "text", content })}\n\n`);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") {
              fullResponse += block.text;
              res.write(`data: ${JSON.stringify({ type: "text", content: block.text })}\n\n`);
            } else if (block.type === "tool_use") {
              currentToolId = block.id || uuidv4();
              const toolInput = (block as any).input || {};
              console.log(`[Stream] Tool use: id=${currentToolId}, name=${block.name}`);
              console.log(`[Stream] Tool input:`, JSON.stringify(toolInput, null, 2));
              
              const toolCall = { 
                id: currentToolId, 
                name: block.name, 
                input: toolInput,
                status: "running" 
              };
              toolCalls.push(toolCall);
              res.write(`data: ${JSON.stringify({ 
                type: "tool", 
                id: toolCall.id,
                name: toolCall.name,
                input: toolCall.input,
                status: toolCall.status
              })}\n\n`);
            }
          }
        }
      } else if ((msg as any).type === "tool_result") {
        // 处理工具结果（独立的消息类型）
        const msgAny = msg as any;
        const toolId = msgAny.tool_use_id || currentToolId;
        const isError = msgAny.is_error || false;
        const content = msgAny.content;
        
        console.log(`[Stream] Tool result: tool_use_id=${toolId}, is_error=${isError}`);
        console.log(`[Stream] Tool result content type:`, typeof content);
        console.log(`[Stream] Tool result content:`, typeof content === 'string' ? content.slice(0, 500) : JSON.stringify(content, null, 2)?.slice(0, 500));
        
        const tool = toolCalls.find(t => t.id === toolId) || toolCalls[toolCalls.length - 1];
        if (tool) {
          tool.status = isError ? "error" : "completed";
          tool.isError = isError;
          tool.result = typeof content === 'string' 
            ? content 
            : JSON.stringify(content);
          res.write(`data: ${JSON.stringify({ 
            type: "tool_result", 
            toolId: tool.id, 
            content: tool.result,
            isError: isError
          })}\n\n`);
        }
        currentToolId = null;
      } else if (msg.type === "result") {
        // 完成时确保所有工具都标记为完成
        toolCalls.forEach(tool => {
          if (tool.status === "running") {
            tool.status = "completed";
            res.write(`data: ${JSON.stringify({ type: "tool_result", toolId: tool.id, content: tool.result || "已完成" })}\n\n`);
          }
        });
        const doneMsg = msg as any;
        res.write(`data: ${JSON.stringify({
          type: "done",
          duration: doneMsg.duration ?? doneMsg.duration_ms ?? 0,
          cost: doneMsg.cost ?? doneMsg.total_cost_usd ?? 0,
        })}\n\n`);
      }
    }

    // 保存助手消息到数据库
    db.createMessage({
      id: assistantMessageId,
      session_id: session.id,
      role: 'assistant',
      content: fullResponse,
      model: selectedModel,
      created_at: new Date().toISOString(),
      tool_calls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null
    });

    // 更新会话标题（如果是第一条消息）
    const messages = db.getMessagesBySession(session.id);
    if (messages.length <= 2) {
      db.updateSession(session.id, { 
        title: message.slice(0, 30) + (message.length > 30 ? '...' : ''),
        model: selectedModel
      });
    }

    console.log(`[Chat] 请求完成 ✓`);
    res.end();
  } catch (error: any) {
    console.error(`\n[Chat] ========== 错误 ==========`);
    console.error(`[Chat] Error Name:`, error?.name);
    console.error(`[Chat] Error Message:`, error?.message);
    console.error(`[Chat] Error Code:`, error?.code);
    console.error(`[Chat] Error Stack:`, error?.stack);
    console.error(`[Chat] Full Error:`, JSON.stringify(error, null, 2));
    
    const errorMessage = error?.message || "处理请求时发生错误";
    res.write(`data: ${JSON.stringify({ type: "error", message: errorMessage })}\n\n`);
    res.end();
  }
});

// ============= FAQ 知识库 API =============

// 获取 FAQ 列表（支持分类筛选）
app.get("/api/faq", (req, res) => {
  try {
    const { category } = req.query;
    const faqs = db.getAllFaqs(category as string | undefined);
    res.json({ faqs });
  } catch (error: any) {
    console.error("[FAQ] List error:", error);
    res.status(500).json({ error: error?.message || "获取 FAQ 列表失败" });
  }
});

// 新建 FAQ
app.post("/api/faq", (req, res) => {
  try {
    const { category, question, answer, keywords = '' } = req.body;
    if (!category || !question || !answer) {
      return res.status(400).json({ error: "分类、问题、答案均不能为空" });
    }
    const now = new Date().toISOString();
    const faq = db.createFaq({
      id: uuidv4(),
      category,
      question,
      answer,
      keywords,
      created_at: now,
      updated_at: now,
    });
    res.json({ success: true, faq });
  } catch (error: any) {
    console.error("[FAQ] Create error:", error);
    res.status(500).json({ error: error?.message || "创建 FAQ 失败" });
  }
});

// 更新 FAQ
app.put("/api/faq/:id", (req, res) => {
  try {
    const { id } = req.params;
    const { category, question, answer, keywords } = req.body;
    const success = db.updateFaq(id, { category, question, answer, keywords });
    if (!success) return res.status(404).json({ error: "FAQ 不存在" });
    res.json({ success: true });
  } catch (error: any) {
    console.error("[FAQ] Update error:", error);
    res.status(500).json({ error: error?.message || "更新 FAQ 失败" });
  }
});

// 删除 FAQ
app.delete("/api/faq/:id", (req, res) => {
  try {
    const { id } = req.params;
    const success = db.deleteFaq(id);
    if (!success) return res.status(404).json({ error: "FAQ 不存在" });
    res.json({ success: true });
  } catch (error: any) {
    console.error("[FAQ] Delete error:", error);
    res.status(500).json({ error: error?.message || "删除 FAQ 失败" });
  }
});

// FAQ 全文检索
app.get("/api/faq/search", (req, res) => {
  try {
    const { q, category, limit } = req.query;
    if (!q || typeof q !== 'string') {
      return res.json({ results: [], total: 0 });
    }
    const results = db.searchFaqs(q, category as string | undefined, parseInt(limit as string) || 5);
    res.json({ results, total: results.length });
  } catch (error: any) {
    console.error("[FAQ] Search error:", error);
    res.status(500).json({ error: error?.message || "检索 FAQ 失败" });
  }
});

// ============= 转人工工单 API =============

// 主动转人工（前端可调用，通常由 AI 工具触发）
app.post("/api/sessions/:sessionId/escalate", (req, res) => {
  try {
    const { sessionId } = req.params;
    const { reason, intent } = req.body;
    const session = db.getSession(sessionId);
    if (!session) return res.status(404).json({ error: "会话不存在" });

    const escalationId = uuidv4();
    const now = new Date().toISOString();
    db.createEscalation({
      id: escalationId,
      session_id: sessionId,
      reason: reason || "用户主动转人工",
      intent: intent || 'escalate',
      status: 'pending',
      agent_id: null,
      created_at: now,
      taken_at: null,
      resolved_at: null,
    });
    db.updateSession(sessionId, { status: 'escalated', intent: intent || 'escalate' });
    res.json({ success: true, escalationId, message: "已转接人工客服，请等待接单" });
  } catch (error: any) {
    console.error("[Escalate] error:", error);
    res.status(500).json({ error: error?.message || "转人工失败" });
  }
});

// 客服接管会话
app.post("/api/sessions/:sessionId/takeover", (req, res) => {
  try {
    const { sessionId } = req.params;
    const { agentId = 'agent-001' } = req.body;
    const session = db.getSession(sessionId);
    if (!session) return res.status(404).json({ error: "会话不存在" });

    const escalation = db.getEscalationBySession(sessionId);
    if (!escalation) return res.status(400).json({ error: "该会话没有转人工工单" });

    db.takeEscalation(escalation.id, agentId, sessionId);
    const updated = db.getSession(sessionId);
    res.json({ success: true, session: updated });
  } catch (error: any) {
    console.error("[Takeover] error:", error);
    res.status(500).json({ error: error?.message || "接管失败" });
  }
});

// 标记会话已解决
app.post("/api/sessions/:sessionId/resolve", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = db.getSession(sessionId);
    if (!session) return res.status(404).json({ error: "会话不存在" });

    const escalation = db.getEscalationBySession(sessionId);
    if (escalation) {
      db.resolveEscalation(escalation.id, sessionId);
    } else {
      db.updateSession(sessionId, { status: 'resolved' });
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Resolve] error:", error);
    res.status(500).json({ error: error?.message || "标记解决失败" });
  }
});

// ============= 人工客服消息 API =============

// 人工客服发送消息（不调用 AI）
app.post("/api/admin/sessions/:sessionId/messages", (req, res) => {
  try {
    const { sessionId } = req.params;
    const { content, agentId = 'agent-001' } = req.body;
    if (!content) return res.status(400).json({ error: "消息内容不能为空" });

    const session = db.getSession(sessionId);
    if (!session) return res.status(404).json({ error: "会话不存在" });

    const messageId = uuidv4();
    db.createMessage({
      id: messageId,
      session_id: sessionId,
      role: 'assistant',
      content,
      model: null,
      created_at: new Date().toISOString(),
      tool_calls: null,
      sender: 'human',
    });
    res.json({ success: true, messageId });
  } catch (error: any) {
    console.error("[Admin Message] error:", error);
    res.status(500).json({ error: error?.message || "发送消息失败" });
  }
});

// ============= 满意度评分 API =============

// 提交满意度评分
app.post("/api/sessions/:sessionId/rating", (req, res) => {
  try {
    const { sessionId } = req.params;
    const { score, comment } = req.body;
    if (!score || score < 1 || score > 5) {
      return res.status(400).json({ error: "评分必须在 1-5 之间" });
    }
    const session = db.getSession(sessionId);
    if (!session) return res.status(404).json({ error: "会话不存在" });

    const existing = db.getRatingBySession(sessionId);
    if (existing) return res.status(400).json({ error: "该会话已评分过" });

    const ratingId = uuidv4();
    db.createRating({
      id: ratingId,
      session_id: sessionId,
      score: parseInt(score),
      comment: comment || null,
      created_at: new Date().toISOString(),
    });
    // 评分后将会话标记为 resolved
    db.updateSession(sessionId, { status: 'resolved' });
    res.json({ success: true, ratingId });
  } catch (error: any) {
    console.error("[Rating] Create error:", error);
    res.status(500).json({ error: error?.message || "提交评分失败" });
  }
});

// 获取满意度评分
app.get("/api/sessions/:sessionId/rating", (req, res) => {
  try {
    const { sessionId } = req.params;
    const rating = db.getRatingBySession(sessionId);
    res.json({ rating: rating || null });
  } catch (error: any) {
    console.error("[Rating] Get error:", error);
    res.status(500).json({ error: error?.message || "获取评分失败" });
  }
});

// ============= 管理后台 API =============

// 管理后台会话列表（带筛选 + 分页）
app.get("/api/admin/sessions", (req, res) => {
  try {
    const { status, intent, keyword, page = 1, pageSize = 20 } = req.query;
    const result = db.getAdminSessions({
      status: status as string | undefined,
      intent: intent as string | undefined,
      keyword: keyword as string | undefined,
      page: parseInt(page as string) || 1,
      pageSize: parseInt(pageSize as string) || 20,
    });
    // 转换字段名为 camelCase 给前端
    const sessions = result.sessions.map(s => ({
      id: s.id,
      title: s.title,
      model: s.model,
      status: s.status || 'pending',
      intent: s.intent || 'other',
      handledBy: s.handled_by,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      messageCount: s.message_count,
      ratingScore: s.rating_score,
      ratingComment: s.rating_comment,
      escalationId: s.escalation_id,
      escalationReason: s.escalation_reason,
      escalationStatus: s.escalation_status,
    }));
    res.json({ sessions, total: result.total, page: parseInt(page as string) || 1, pageSize: parseInt(pageSize as string) || 20 });
  } catch (error: any) {
    console.error("[Admin Sessions] error:", error);
    res.status(500).json({ error: error?.message || "获取会话列表失败" });
  }
});

// 管理后台会话详情（带消息列表）
app.get("/api/admin/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = db.getSession(sessionId);
    if (!session) return res.status(404).json({ error: "会话不存在" });

    const messages = db.getMessagesBySession(sessionId);
    const parsedMessages = messages.map(msg => ({
      ...msg,
      sender: msg.sender || (msg.role === 'user' ? 'user' : 'ai'),
      tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : null,
    }));

    const escalation = db.getEscalationBySession(sessionId);
    const rating = db.getRatingBySession(sessionId);

    res.json({
      session: {
        ...session,
        status: session.status || 'pending',
        intent: session.intent || 'other',
        handledBy: session.handled_by,
      },
      messages: parsedMessages,
      escalation: escalation || null,
      rating: rating || null,
    });
  } catch (error: any) {
    console.error("[Admin Session Detail] error:", error);
    res.status(500).json({ error: error?.message || "获取会话详情失败" });
  }
});

// 满意度统计
app.get("/api/admin/stats", (req, res) => {
  try {
    const stats = db.getRatingStats();
    res.json(stats);
  } catch (error: any) {
    console.error("[Admin Stats] error:", error);
    res.status(500).json({ error: error?.message || "获取统计数据失败" });
  }
});

// 线索列表
app.get("/api/admin/leads", (req, res) => {
  try {
    const { status, keyword, page = 1, pageSize = 20 } = req.query;
    const result = db.getLeads({
      status: status as string | undefined,
      keyword: keyword as string | undefined,
      page: parseInt(page as string) || 1,
      pageSize: parseInt(pageSize as string) || 20,
    });
    const leads = result.leads.map(lead => ({
      id: lead.id,
      sessionId: lead.session_id,
      name: lead.name,
      contact: lead.contact,
      channel: lead.channel,
      need: lead.need,
      budget: lead.budget,
      timeline: lead.timeline,
      priority: lead.priority,
      status: lead.status,
      summary: lead.summary,
      sourceMessage: lead.source_message,
      createdAt: lead.created_at,
      updatedAt: lead.updated_at,
    }));
    res.json({ leads, total: result.total, page: parseInt(page as string) || 1, pageSize: parseInt(pageSize as string) || 20 });
  } catch (error: any) {
    console.error("[Admin Leads] error:", error);
    res.status(500).json({ error: error?.message || "获取线索列表失败" });
  }
});

// 更新线索状态/优先级
app.patch("/api/admin/leads/:leadId", (req, res) => {
  try {
    const { leadId } = req.params;
    const { status, priority, summary } = req.body;
    const ok = db.updateLead(leadId, { status, priority, summary });
    if (!ok) return res.status(404).json({ error: "线索不存在或无可更新字段" });
    const lead = db.getLeadById(leadId);
    res.json({ success: true, lead });
  } catch (error: any) {
    console.error("[Admin Leads] update error:", error);
    res.status(500).json({ error: error?.message || "更新线索失败" });
  }
});

// ============= 种子数据 API =============

// 注入示例数据（FAQ + 订单）
app.post("/api/seed", (req, res) => {
  try {
    const result = seedData();
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error("[Seed] error:", error);
    res.status(500).json({ error: error?.message || "注入种子数据失败" });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║                                            ║
║     ◉ 智能客服 API 服务器已启动             ║
║                                            ║
║     地址: http://localhost:${PORT}            ║
║     数据库: SQLite (data/chat.db)          ║
║     管理后台: http://localhost:5173/admin  ║
║                                            ║
╚════════════════════════════════════════════╝
  `);
});
