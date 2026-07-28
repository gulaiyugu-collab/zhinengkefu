import { useState, useEffect } from 'react';
import { Card, Loading } from 'tdesign-react';
import { RatingStats } from '../types';

/**
 * 管理后台 - 满意度统计页
 *
 * 内容：
 * - 4 个统计卡片（总会话 / 已解决 / 平均评分 / 转人工率）
 * - 评分分布柱状图（1-5 星各有多少评分）
 * - 意图分布横条图
 *
 * 全部用 CSS 实现，不引入图表库。
 */
export function AdminStatsPage() {
  const [stats, setStats] = useState<RatingStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const resp = await fetch('/api/admin/stats');
        const data = await resp.json();
        setStats(data);
      } catch (e) {
        console.error('Fetch stats error:', e);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full">
        <Loading />
      </div>
    );
  }

  if (!stats) {
    return <div className="p-6">加载统计数据失败</div>;
  }

  const statCards = [
    { label: '总会话数', value: stats.totalSessions, color: 'var(--td-brand-color)', suffix: '' },
    { label: '已解决', value: stats.resolvedSessions, color: 'var(--td-success-color)', suffix: '' },
    { label: '平均评分', value: stats.avgRating !== null ? stats.avgRating.toFixed(2) : '—', color: 'var(--td-warning-color)', suffix: stats.avgRating !== null ? ' / 5' : '' },
    { label: '转人工率', value: (stats.escalationRate * 100).toFixed(1), color: 'var(--td-error-color)', suffix: '%' },
  ];

  // 评分分布柱状图
  const ratingValues = [1, 2, 3, 4, 5];
  const maxRatingCount = Math.max(...ratingValues.map(s => stats.ratingDistribution[String(s)] || 0), 1);

  // 意图分布
  const intentLabels: Record<string, string> = {
    refund: '退款',
    order_query: '订单查询',
    tech_support: '技术支持',
    escalate: '转人工',
    other: '其他',
  };
  const intentEntries = Object.entries(stats.intentDistribution);
  const maxIntentCount = Math.max(...intentEntries.map(([, v]) => v), 1);

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--td-text-color-primary)' }}>
        满意度统计
      </h2>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {statCards.map(card => (
          <Card key={card.label}>
            <div className="text-center">
              <div style={{ fontSize: '28px', fontWeight: 700, color: card.color }}>
                {card.value}<span style={{ fontSize: '14px', fontWeight: 400 }}>{card.suffix}</span>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--td-text-color-secondary)', marginTop: '4px' }}>
                {card.label}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* 评分分布 */}
        <Card title="评分分布">
          <div className="py-4 space-y-3">
            {ratingValues.map(star => {
              const count = stats.ratingDistribution[String(star)] || 0;
              const width = (count / maxRatingCount) * 100;
              const barColor = star >= 4 ? 'var(--td-success-color)' : star >= 3 ? 'var(--td-warning-color)' : 'var(--td-error-color)';
              return (
                <div key={star} className="flex items-center gap-3">
                  <div style={{ width: '40px', fontSize: '13px', color: 'var(--td-text-color-secondary)' }}>
                    {star} ★
                  </div>
                  <div className="flex-1 h-6 rounded" style={{ backgroundColor: 'var(--td-bg-color-component)' }}>
                    <div
                      className="h-full rounded transition-all"
                      style={{ width: `${width}%`, backgroundColor: barColor, minWidth: count > 0 ? '8px' : '0' }}
                    />
                  </div>
                  <div style={{ width: '40px', textAlign: 'right', fontSize: '13px', color: 'var(--td-text-color-primary)' }}>
                    {count}
                  </div>
                </div>
              );
            })}
            {stats.totalSessions === 0 && (
              <div className="text-center py-4" style={{ color: 'var(--td-text-color-placeholder)', fontSize: '13px' }}>
                暂无数据
              </div>
            )}
          </div>
        </Card>

        {/* 意图分布 */}
        <Card title="意图分布">
          <div className="py-4 space-y-3">
            {intentEntries.length === 0 && (
              <div className="text-center py-4" style={{ color: 'var(--td-text-color-placeholder)', fontSize: '13px' }}>
                暂无数据
              </div>
            )}
            {intentEntries.map(([intent, count]) => {
              const width = (count / maxIntentCount) * 100;
              const intentColors: Record<string, string> = {
                refund: 'var(--td-error-color)',
                order_query: 'var(--td-brand-color)',
                tech_support: 'var(--td-warning-color)',
                escalate: 'var(--td-text-color-secondary)',
                other: 'var(--td-text-color-placeholder)',
              };
              return (
                <div key={intent} className="flex items-center gap-3">
                  <div style={{ width: '70px', fontSize: '13px', color: 'var(--td-text-color-secondary)' }}>
                    {intentLabels[intent] || intent}
                  </div>
                  <div className="flex-1 h-6 rounded" style={{ backgroundColor: 'var(--td-bg-color-component)' }}>
                    <div
                      className="h-full rounded transition-all"
                      style={{ width: `${width}%`, backgroundColor: intentColors[intent] || 'var(--td-brand-color)', minWidth: count > 0 ? '8px' : '0' }}
                    />
                  </div>
                  <div style={{ width: '40px', textAlign: 'right', fontSize: '13px', color: 'var(--td-text-color-primary)' }}>
                    {count}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* 状态分布 */}
      <Card title="会话状态分布" className="mt-4">
        <div className="py-4 grid grid-cols-4 gap-4">
          <div className="text-center">
            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--td-brand-color)' }}>{stats.pendingSessions}</div>
            <div style={{ fontSize: '12px', color: 'var(--td-text-color-secondary)' }}>AI 处理中</div>
          </div>
          <div className="text-center">
            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--td-warning-color)' }}>{stats.escalatedSessions}</div>
            <div style={{ fontSize: '12px', color: 'var(--td-text-color-secondary)' }}>转人工中</div>
          </div>
          <div className="text-center">
            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--td-success-color)' }}>{stats.resolvedSessions}</div>
            <div style={{ fontSize: '12px', color: 'var(--td-text-color-secondary)' }}>已解决</div>
          </div>
          <div className="text-center">
            <div style={{ fontSize: '24px', fontWeight: 700, color: 'var(--td-text-color-primary)' }}>
              {stats.totalSessions - stats.pendingSessions - stats.escalatedSessions - stats.resolvedSessions}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--td-text-color-secondary)' }}>其他</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
