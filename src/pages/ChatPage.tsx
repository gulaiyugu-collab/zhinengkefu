import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from 'tdesign-react';
import { CheckCircleIcon } from 'tdesign-icons-react';
import { Model, Session, PermissionMode, CustomAgent, PermissionRequest, Message } from '../types';
import { NewChatView } from '../components/NewChatView';
import { ChatMessages } from '../components/ChatMessages';
import { ChatInput } from '../components/ChatInput';
import { EscalationBanner } from '../components/EscalationBanner';
import { RatingDialog } from '../components/RatingDialog';

interface ChatPageProps {
  currentSession: Session | undefined;
  models: Model[];
  selectedModel: string;
  agents: CustomAgent[];
  isLoading: boolean;
  inputValue: string;
  permissionRequest: PermissionRequest | null;
  permissionMode: PermissionMode;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
  updateSessionMessages: (sessionId: string, updater: (messages: Message[]) => Message[]) => void;
  onSendMessage: (message: string, newChatOptions?: NewChatOptions, onNavigate?: (path: string) => void) => void;
  onStop: () => void;
  onInputChange: (value: string) => void;
  onModelChange: (modelId: string) => void;
  onPermissionAllow: () => void;
  onPermissionDeny: () => void;
  onPermissionModeChange: (mode: PermissionMode) => void;
}

interface NewChatOptions {
  agentId: string;
  cwd: string;
  permissionMode: PermissionMode;
}

export function ChatPage({
  currentSession,
  models,
  selectedModel,
  agents,
  isLoading,
  inputValue,
  permissionRequest,
  permissionMode,
  updateSession,
  updateSessionMessages,
  onSendMessage,
  onStop,
  onInputChange,
  onModelChange,
  onPermissionAllow,
  onPermissionDeny,
  onPermissionModeChange,
}: ChatPageProps) {
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 新对话页面状态
  const [newChatAgentId, setNewChatAgentId] = useState('default');
  const [newChatCwd, setNewChatCwd] = useState('');

  // 评分弹窗状态
  const [ratingVisible, setRatingVisible] = useState(false);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages]);

  // 转人工后会话状态轮询：拉取人工客服新消息
  useEffect(() => {
    if (!currentSession?.id) return;
    const status = currentSession.status;
    if (status !== 'escalated' && status !== 'agent_handling') return;

    let active = true;
    const knownMessageIds = new Set(currentSession.messages.map(m => m.id));

    const pollMessages = async () => {
      try {
        const resp = await fetch(`/api/sessions/${currentSession.id}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (!active) return;

        // 同步会话状态
        const newStatus = data.session?.status;
        if (newStatus && newStatus !== status) {
          updateSession(currentSession.id!, { status: newStatus });
        }

        // 合并新消息（人工客服发送的）
        const serverMessages: any[] = data.messages || [];
        const newMsgs = serverMessages.filter((m: any) => !knownMessageIds.has(m.id));
        if (newMsgs.length > 0) {
          newMsgs.forEach(m => knownMessageIds.add(m.id));
          updateSessionMessages(currentSession.id!, (prev) => {
            const mapped: Message[] = newMsgs.map(m => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: new Date(m.created_at),
              sender: m.sender || 'ai',
            }));
            return [...prev, ...mapped];
          });
        }
      } catch (e) {
        // 忽略轮询错误
      }
    };

    pollMessages();
    const timer = setInterval(pollMessages, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [currentSession?.id, currentSession?.status, updateSession, updateSessionMessages]);

  // 处理发送消息
  const handleSend = useCallback((message: string) => {
    if (!currentSession) {
      // 新对话
      onSendMessage(message, {
        agentId: newChatAgentId,
        cwd: newChatCwd,
        permissionMode: permissionMode,
      }, (path) => {
        // 重置新对话选项
        setNewChatAgentId('default');
        setNewChatCwd('');
        navigate(path);
      });
    } else {
      onSendMessage(message);
    }
  }, [currentSession, newChatAgentId, newChatCwd, permissionMode, onSendMessage, navigate]);

  // 结束对话 -> 弹出评分
  const handleEndSession = useCallback(() => {
    setRatingVisible(true);
  }, []);

  // 评分成功后将会话标记为已解决
  const handleRatingSuccess = useCallback(() => {
    if (currentSession?.id) {
      updateSession(currentSession.id, { status: 'resolved' });
    }
  }, [currentSession?.id, updateSession]);

  const showNewChatView = !currentSession || currentSession.messages.length === 0;
  const hasMessages = currentSession && currentSession.messages.length > 0;
  const sessionActive = currentSession && currentSession.status !== 'resolved';

  return (
    <>
      {/* 转人工横幅 */}
      <EscalationBanner
        session={currentSession}
        onStatusChange={(newStatus) => {
          if (currentSession?.id && newStatus !== currentSession.status) {
            updateSession(currentSession.id, { status: newStatus as Session['status'] });
          }
        }}
      />

      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto p-6 relative">
        {showNewChatView ? (
          <NewChatView
            agents={agents}
            models={models}
            selectedModel={selectedModel}
            newChatAgentId={newChatAgentId}
            newChatCwd={newChatCwd}
            newChatPermissionMode={permissionMode}
            onSelectModel={onModelChange}
            onSelectAgent={setNewChatAgentId}
            onSetCwd={setNewChatCwd}
            onSetPermissionMode={onPermissionModeChange}
          />
        ) : (
          <>
            <ChatMessages
              messages={currentSession!.messages}
              models={models}
              messagesEndRef={messagesEndRef}
              permissionRequest={permissionRequest}
              onPermissionAllow={onPermissionAllow}
              onPermissionDeny={onPermissionDeny}
            />
            {/* 结束对话按钮（有消息且会话未结束时显示） */}
            {hasMessages && sessionActive && (
              <div className="flex justify-center mt-4 mb-2">
                <Button
                  icon={<CheckCircleIcon />}
                  variant="outline"
                  theme="success"
                  onClick={handleEndSession}
                >
                  结束对话并评分
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 输入区域 */}
      <ChatInput
        inputValue={inputValue}
        selectedModel={selectedModel}
        models={models}
        isLoading={isLoading}
        permissionMode={permissionMode}
        onSend={handleSend}
        onStop={onStop}
        onChange={onInputChange}
        onModelChange={onModelChange}
        onPermissionModeChange={onPermissionModeChange}
      />

      {/* 评分弹窗 */}
      <RatingDialog
        visible={ratingVisible}
        session={currentSession}
        onClose={() => setRatingVisible(false)}
        onSubmitSuccess={handleRatingSuccess}
      />
    </>
  );
}
