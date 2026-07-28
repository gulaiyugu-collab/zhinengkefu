import { UserIcon } from 'tdesign-icons-react';
import { Bot, Headphones } from 'lucide-react';
import { ChatMarkdown } from '@tdesign-react/chat';
import { ToolCallsCollapse } from './ToolCallsCollapse';
import { Message } from '../types';

interface AdminMessageListProps {
  messages: Message[];
}

/**
 * 管理后台消息列表
 *
 * 与用户端 ChatMessages 区别：
 * - 区分 AI / 人工客服 / 用户消息，用不同颜色和图标
 * - 显示发送者标签（AI / 人工客服 · agentId / 用户）
 * - 支持工具调用折叠展示
 */
export function AdminMessageList({ messages }: AdminMessageListProps) {
  const getMessageMeta = (msg: Message) => {
    if (msg.role === 'user') {
      return { label: '用户', icon: <UserIcon />, bg: 'var(--td-brand-color)', color: 'white' };
    }
    // assistant 消息：根据 sender 区分 AI 和人工
    if (msg.sender === 'human') {
      return { label: '人工客服', icon: <Headphones size={16} />, bg: 'var(--td-success-color)', color: 'white' };
    }
    // sender === 'ai' 或 undefined
    return { label: 'AI 助手', icon: <Bot size={16} />, bg: 'var(--td-bg-color-component)', color: 'var(--td-text-color-primary)' };
  };

  const formatTime = (ts: string | Date) => {
    const d = typeof ts === 'string' ? new Date(ts) : ts;
    return d.toLocaleString('zh-CN', { hour12: false });
  };

  return (
    <div className="flex flex-col gap-4 max-w-4xl mx-auto p-4">
      {messages.map(message => {
        const meta = getMessageMeta(message);
        const isUser = message.role === 'user';
        return (
          <div key={message.id} className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
            <div
              className="w-8 h-8 flex items-center justify-center flex-shrink-0 rounded-full self-start"
              style={{ backgroundColor: meta.bg, color: meta.color }}
            >
              {meta.icon}
            </div>
            <div className={`flex flex-col gap-1 max-w-[75%] ${isUser ? 'items-end' : ''}`}>
              {/* 发送者标签 + 时间 */}
              <div className="flex items-center gap-2" style={{ fontSize: '12px', color: 'var(--td-text-color-placeholder)' }}>
                <span style={{ fontWeight: 500, color: 'var(--td-text-color-secondary)' }}>{meta.label}</span>
                {message.timestamp && <span>{formatTime(message.timestamp)}</span>}
              </div>

              {/* 消息内容 */}
              {isUser ? (
                <div
                  className="px-3 py-2 text-sm break-words"
                  style={{
                    backgroundColor: 'var(--td-brand-color)',
                    color: 'white',
                    borderRadius: '12px 12px 4px 12px',
                  }}
                >
                  {message.content}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {/* 工具调用（如果有） */}
                  {message.toolCalls && message.toolCalls.length > 0 && (
                    <ToolCallsCollapse toolCalls={message.toolCalls} />
                  )}
                  {/* 文本内容 */}
                  {message.content && (
                    <div
                      className="px-3 py-2 text-sm break-words"
                      style={{
                        backgroundColor: message.sender === 'human'
                          ? 'var(--td-success-color-1)'
                          : 'var(--td-bg-color-component)',
                        color: 'var(--td-text-color-primary)',
                        borderRadius: '12px 12px 12px 4px',
                        border: message.sender === 'human'
                          ? '1px solid var(--td-success-color-2)'
                          : 'none',
                      }}
                    >
                      <div className="chat-markdown">
                        <ChatMarkdown content={message.content} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
