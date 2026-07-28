import { useState, useEffect } from 'react';
import { Headphones } from 'lucide-react';
import { Session } from '../types';

interface EscalationBannerProps {
  session: Session | undefined;
  onStatusChange?: (status: string) => void;
}

/**
 * 转人工横幅
 *
 * 当会话状态为 escalated（待接单）或 agent_handling（人工处理中）时显示。
 * 每 3 秒轮询 /api/sessions/:id 检测状态变化和人工新消息。
 */
export function EscalationBanner({ session, onStatusChange }: EscalationBannerProps) {
  const [currentStatus, setCurrentStatus] = useState<string>(session?.status || 'pending');

  // 轮询会话状态
  useEffect(() => {
    if (!session?.id) return;
    if (session.status === 'pending' || session.status === 'resolved' || !session.status) {
      setCurrentStatus('pending');
      return;
    }

    let active = true;
    const poll = async () => {
      try {
        const resp = await fetch(`/api/sessions/${session.id}`);
        if (!resp.ok) return;
        const data = await resp.json();
        if (!active) return;
        const newStatus = data.session?.status || 'pending';
        if (newStatus !== currentStatus) {
          setCurrentStatus(newStatus);
          onStatusChange?.(newStatus);
        }
      } catch (e) {
        // 忽略轮询错误
      }
    };

    // 立即查一次
    poll();
    // 每 3 秒轮询
    const timer = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session?.id, session?.status, currentStatus, onStatusChange]);

  if (!session || currentStatus === 'pending' || currentStatus === 'resolved') {
    return null;
  }

  const isEscalated = currentStatus === 'escalated';
  const isHandling = currentStatus === 'agent_handling';

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5"
      style={{
        backgroundColor: isEscalated ? 'var(--td-warning-color-1)' : 'var(--td-success-color-1)',
        borderBottom: `1px solid ${isEscalated ? 'var(--td-warning-color)' : 'var(--td-success-color)'}`,
      }}
    >
      <Headphones size={20} style={{ color: isEscalated ? 'var(--td-warning-color)' : 'var(--td-success-color)' }} />
      <div className="flex-1 flex items-center gap-2">
        <span style={{ color: 'var(--td-text-color-primary)', fontSize: '14px' }}>
          {isEscalated ? '已转接人工客服，正在等待客服接单...' : '人工客服已接入，正在为您服务'}
        </span>
        {isEscalated && (
          <span className="flex items-center gap-1.5" style={{ color: 'var(--td-text-color-secondary)', fontSize: '12px' }}>
            <span className="inline-block h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: 'currentColor' }} />
            等待中
          </span>
        )}
      </div>
    </div>
  );
}
