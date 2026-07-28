import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Tag, Pagination, Select, Input, Button, Card } from 'tdesign-react';
import { SearchIcon } from 'tdesign-icons-react';
import { AdminSessionRow, SessionStatus, Intent } from '../types';

/**
 * 管理后台 - 对话列表页
 *
 * 支持按状态、意图、关键词筛选 + 分页
 * 点击行进入对话详情
 */
export function AdminSessionsPage() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<AdminSessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // 筛选条件
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [intentFilter, setIntentFilter] = useState<string>('');
  const [keyword, setKeyword] = useState<string>('');

  // 分页
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (statusFilter) params.set('status', statusFilter);
      if (intentFilter) params.set('intent', intentFilter);
      if (keyword) params.set('keyword', keyword);

      const resp = await fetch(`/api/admin/sessions?${params.toString()}`);
      const data = await resp.json();
      setSessions(data.sessions || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error('Fetch sessions error:', e);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, intentFilter, keyword]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const statusTag = (status: SessionStatus | string) => {
    const map: Record<string, { color: string; label: string }> = {
      pending: { color: 'blue', label: 'AI 处理中' },
      escalated: { color: 'warning', label: '待接单' },
      agent_handling: { color: 'success', label: '人工处理中' },
      resolved: { color: 'default', label: '已解决' },
    };
    const s = map[status] || map.pending;
    return <Tag theme={s.color as any} variant="light-outline">{s.label}</Tag>;
  };

  const intentTag = (intent: Intent | string | null) => {
    if (!intent) return <span style={{ color: 'var(--td-text-color-placeholder)' }}>—</span>;
    const map: Record<string, { color: string; label: string }> = {
      refund: { color: 'error', label: '退款' },
      order_query: { color: 'primary', label: '订单查询' },
      tech_support: { color: 'warning', label: '技术支持' },
      escalate: { color: 'default', label: '转人工' },
      other: { color: 'default', label: '其他' },
    };
    const i = map[intent] || map.other;
    return <Tag theme={i.color as any} variant="light">{i.label}</Tag>;
  };

  const ratingText = (score: number | null) => {
    if (score === null || score === undefined) return <span style={{ color: 'var(--td-text-color-placeholder)' }}>未评</span>;
    return <span style={{ color: score >= 4 ? 'var(--td-success-color)' : score >= 3 ? 'var(--td-warning-color)' : 'var(--td-error-color)' }}>★ {score}</span>;
  };

  const columns = [
    { colKey: 'title', title: '会话标题', minWidth: 200, ellipsis: true },
    {
      colKey: 'status',
      title: '状态',
      width: 120,
      cell: ({ row }: { row: AdminSessionRow }) => statusTag(row.status),
    },
    {
      colKey: 'intent',
      title: '意图',
      width: 110,
      cell: ({ row }: { row: AdminSessionRow }) => intentTag(row.intent),
    },
    { colKey: 'messageCount', title: '消息数', width: 80, align: 'center' },
    {
      colKey: 'ratingScore',
      title: '评分',
      width: 80,
      align: 'center',
      cell: ({ row }: { row: AdminSessionRow }) => ratingText(row.ratingScore),
    },
    {
      colKey: 'createdAt',
      title: '创建时间',
      width: 170,
      cell: ({ row }: { row: AdminSessionRow }) => new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false }),
    },
    {
      colKey: 'updatedAt',
      title: '更新时间',
      width: 170,
      cell: ({ row }: { row: AdminSessionRow }) => new Date(row.updatedAt).toLocaleString('zh-CN', { hour12: false }),
    },
  ];

  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--td-text-color-primary)' }}>
        对话记录
      </h2>

      {/* 筛选区 */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--td-text-color-secondary)', fontSize: '14px' }}>状态：</span>
            <Select
              value={statusFilter || undefined}
              onChange={(v) => { setStatusFilter(v as string); setPage(1); }}
              clearable
              placeholder="全部状态"
              style={{ width: 140 }}
              options={[
                { label: 'AI 处理中', value: 'pending' },
                { label: '待接单', value: 'escalated' },
                { label: '人工处理中', value: 'agent_handling' },
                { label: '已解决', value: 'resolved' },
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--td-text-color-secondary)', fontSize: '14px' }}>意图：</span>
            <Select
              value={intentFilter || undefined}
              onChange={(v) => { setIntentFilter(v as string); setPage(1); }}
              clearable
              placeholder="全部意图"
              style={{ width: 140 }}
              options={[
                { label: '退款', value: 'refund' },
                { label: '订单查询', value: 'order_query' },
                { label: '技术支持', value: 'tech_support' },
                { label: '转人工', value: 'escalate' },
                { label: '其他', value: 'other' },
              ]}
            />
          </div>
          <Input
            value={keyword}
            onChange={(v) => setKeyword(v as string)}
            placeholder="搜索会话标题或 ID"
            clearable
            style={{ width: 220 }}
            onEnter={() => { setPage(1); fetchSessions(); }}
            suffixIcon={<SearchIcon />}
          />
          <Button theme="primary" onClick={() => { setPage(1); fetchSessions(); }}>
            查询
          </Button>
        </div>
      </Card>

      {/* 表格 */}
      <Card>
        <Table
          data={sessions}
          columns={columns as any}
          loading={loading}
          rowKey="id"
          onRowClick={({ row }) => navigate(`/admin/sessions/${row.id}`)}
          hover
          stripe
          style={{ cursor: 'pointer' }}
        />

        {/* 分页 */}
        <div className="mt-4 flex justify-end">
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            onChange={(p) => setPage(p.current as number)}
            onPageSizeChange={(s) => { setPageSize(s as number); setPage(1); }}
            showJumper
          />
        </div>
      </Card>
    </div>
  );
}
