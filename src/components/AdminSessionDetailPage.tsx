import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Card, Input, Tag, MessagePlugin, Textarea } from 'tdesign-react';
import { ArrowLeftIcon, CheckIcon, UserIcon } from 'tdesign-icons-react';
import { AdminMessageList } from './AdminMessageList';
import { Message, SessionStatus, Intent } from '../types';

interface SessionDetail {
  id: string;
  title: string;
  model: string;
  status: SessionStatus | string;
  intent: Intent | string | null;
  handledBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface EscalationDetail {
  id: string;
  reason: string;
  intent: string | null;
  status: string;
  agentId: string | null;
  createdAt: string;
  takenAt: string | null;
  resolvedAt: string | null;
}

interface RatingDetail {
  score: number;
  comment: string | null;
  createdAt: string;
}

/**
 * 管理后台 - 对话详情页
 *
 * 功能：
 * - 显示完整消息时间线
 * - 接管会话（status='escalated' 时）
 * - 人工回复消息
 * - 标记已解决
 * - 每 3 秒轮询新消息
 */
export function AdminSessionDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [escalation, setEscalation] = useState<EscalationDetail | null>(null);
  const [rating, setRating] = useState<RatingDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchDetail = useCallback(async () => {
    if (!sessionId) return;
    try {
      const resp = await fetch(`/api/admin/sessions/${sessionId}`);
      const data = await resp.json();
      setSession(data.session);
      setMessages(data.messages || []);
      setEscalation(data.escalation);
      setRating(data.rating);
    } catch (e) {
      console.error('Fetch detail error:', e);
      MessagePlugin.error('加载会话详情失败');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // 轮询新消息（仅当会话处于 escalated / agent_handling 状态时）
  useEffect(() => {
    if (!session) return;
    if (session.status !== 'escalated' && session.status !== 'agent_handling') return;

    const timer = setInterval(async () => {
      try {
        const resp = await fetch(`/api/admin/sessions/${sessionId}`);
        const data = await resp.json();
        if (data.messages && data.messages.length !== messages.length) {
          setMessages(data.messages);
          setSession(data.session);
        }
      } catch (e) {
        // 忽略
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [session, sessionId, messages.length]);

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleTakeover = async () => {
    try {
      const resp = await fetch(`/api/sessions/${sessionId}/takeover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'agent-001' }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        MessagePlugin.error(data.error || '接管失败');
        return;
      }
      MessagePlugin.success('已接管会话');
      fetchDetail();
    } catch (e: any) {
      MessagePlugin.error(e?.message || '网络错误');
    }
  };

  const handleResolve = async () => {
    try {
      const resp = await fetch(`/api/sessions/${sessionId}/resolve`, {
        method: 'POST',
      });
      const data = await resp.json();
      if (!resp.ok) {
        MessagePlugin.error(data.error || '标记失败');
        return;
      }
      MessagePlugin.success('已标记为已解决');
      fetchDetail();
    } catch (e: any) {
      MessagePlugin.error(e?.message || '网络错误');
    }
  };

  const handleSendReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      const resp = await fetch(`/api/admin/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: replyText, agentId: 'agent-001' }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        MessagePlugin.error(data.error || '发送失败');
        return;
      }
      setReplyText('');
      // 立即刷新消息
      fetchDetail();
    } catch (e: any) {
      MessagePlugin.error(e?.message || '网络错误');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return <div className="p-6">加载中...</div>;
  }

  if (!session) {
    return <div className="p-6">会话不存在</div>;
  }

  const statusMap: Record<string, { color: string; label: string }> = {
    pending: { color: 'blue', label: 'AI 处理中' },
    escalated: { color: 'warning', label: '待接单' },
    agent_handling: { color: 'success', label: '人工处理中' },
    resolved: { color: 'default', label: '已解决' },
  };
  const sTag = statusMap[session.status] || statusMap.pending;

  const canTakeover = session.status === 'escalated';
  const canResolve = session.status === 'agent_handling' || session.status === 'escalated';
  const canReply = session.status === 'agent_handling';

  return (
    <div className="flex flex-col h-full">
      {/* 顶部操作栏 */}
      <div
        className="flex items-center gap-3 px-6 py-3 border-b"
        style={{ borderColor: 'var(--td-component-border)', backgroundColor: 'var(--td-bg-color-container)' }}
      >
        <Button variant="text" icon={<ArrowLeftIcon />} onClick={() => navigate('/admin')}>
          返回列表
        </Button>
        <div className="flex-1">
          <h3 style={{ color: 'var(--td-text-color-primary)', fontWeight: 600 }}>{session.title}</h3>
          <div className="flex items-center gap-3 mt-1" style={{ fontSize: '12px', color: 'var(--td-text-color-placeholder)' }}>
            <span>ID: {session.id.slice(0, 8)}...</span>
            <Tag theme={sTag.color as any} variant="light-outline" size="small">{sTag.label}</Tag>
            {session.handledBy && (
              <span className="flex items-center gap-1">
                <UserIcon size="12px" /> 客服: {session.handledBy}
              </span>
            )}
            {rating && (
              <span style={{ color: rating.score >= 4 ? 'var(--td-success-color)' : 'var(--td-warning-color)' }}>
                ★ 评分: {rating.score}
              </span>
            )}
          </div>
        </div>
        {canTakeover && (
          <Button theme="primary" onClick={handleTakeover}>
            接管会话
          </Button>
        )}
        {canResolve && (
          <Button theme="success" variant="outline" icon={<CheckIcon />} onClick={handleResolve}>
            标记已解决
          </Button>
        )}
      </div>

      {/* 转人工信息（如果有） */}
      {escalation && (
        <div
          className="mx-6 mt-4 p-3 rounded"
          style={{ backgroundColor: 'var(--td-warning-color-1)', border: '1px solid var(--td-warning-color-2)' }}
        >
          <div style={{ fontSize: '13px', color: 'var(--td-text-color-primary)' }}>
            <strong>转人工原因：</strong>{escalation.reason}
          </div>
          <div className="mt-1" style={{ fontSize: '12px', color: 'var(--td-text-color-secondary)' }}>
            工单创建于 {new Date(escalation.createdAt).toLocaleString('zh-CN', { hour12: false })}
            {escalation.takenAt && ` · 接管于 ${new Date(escalation.takenAt).toLocaleString('zh-CN', { hour12: false })}`}
          </div>
        </div>
      )}

      {/* 消息区 */}
      <div className="flex-1 overflow-y-auto py-4">
        <AdminMessageList messages={messages} />
        <div ref={messagesEndRef} />
      </div>

      {/* 人工回复区 */}
      {canReply && (
        <div
          className="p-4 border-t"
          style={{ borderColor: 'var(--td-component-border)', backgroundColor: 'var(--td-bg-color-container)' }}
        >
          <div className="flex gap-2 items-end">
            <Textarea
              value={replyText}
              onChange={(v) => setReplyText(v as string)}
              placeholder="输入人工回复内容..."
              autosize={{ minRows: 1, maxRows: 4 }}
              style={{ flex: 1 }}
              onKeydown={(_, context) => {
                const e = context.e;
                if (!e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  handleSendReply();
                }
              }}
            />
            <Button theme="primary" onClick={handleSendReply} loading={sending}>
              发送
            </Button>
          </div>
        </div>
      )}
      {!canReply && session.status !== 'resolved' && (
        <div
          className="p-4 border-t text-center"
          style={{ borderColor: 'var(--td-component-border)', color: 'var(--td-text-color-placeholder)', fontSize: '13px' }}
        >
          请先接管会话后才能发送人工回复
        </div>
      )}
      {session.status === 'resolved' && (
        <div
          className="p-4 border-t text-center"
          style={{ borderColor: 'var(--td-component-border)', color: 'var(--td-text-color-placeholder)', fontSize: '13px' }}
        >
          该会话已解决，无法再回复
        </div>
      )}
    </div>
  );
}
