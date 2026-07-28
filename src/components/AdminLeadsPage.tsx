import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input, MessagePlugin, Pagination, Select, Space, Table, Tag } from 'tdesign-react';
import { RefreshIcon, SearchIcon } from 'tdesign-icons-react';
import { Lead } from '../types';

const STATUS_OPTIONS = [
  { label: '新线索', value: 'new' },
  { label: '已联系', value: 'contacted' },
  { label: '已判断', value: 'qualified' },
  { label: '已关闭', value: 'closed' },
];

const statusTag = (status: string) => {
  const map: Record<string, { label: string; theme: 'primary' | 'success' | 'warning' | 'default' }> = {
    new: { label: '新线索', theme: 'primary' },
    contacted: { label: '已联系', theme: 'warning' },
    qualified: { label: '已判断', theme: 'success' },
    closed: { label: '已关闭', theme: 'default' },
  };
  const item = map[status] || map.new;
  return <Tag theme={item.theme} variant="light">{item.label}</Tag>;
};

const priorityTag = (priority: string) => {
  const map: Record<string, { label: string; theme: 'danger' | 'warning' | 'default' }> = {
    high: { label: '高', theme: 'danger' },
    medium: { label: '中', theme: 'warning' },
    low: { label: '低', theme: 'default' },
  };
  const item = map[priority] || map.medium;
  return <Tag theme={item.theme} variant="light-outline">{item.label}</Tag>;
};

export function AdminLeadsPage() {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (statusFilter) params.set('status', statusFilter);
      if (keyword.trim()) params.set('keyword', keyword.trim());

      const resp = await fetch(`/api/admin/leads?${params.toString()}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || '加载线索失败');
      setLeads(data.leads || []);
      setTotal(data.total || 0);
    } catch (e: any) {
      MessagePlugin.error(e?.message || '加载线索失败');
    } finally {
      setLoading(false);
    }
  }, [keyword, page, pageSize, statusFilter]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const updateLeadStatus = async (leadId: string, status: string) => {
    try {
      const resp = await fetch(`/api/admin/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || '更新失败');
      MessagePlugin.success('线索状态已更新');
      fetchLeads();
    } catch (e: any) {
      MessagePlugin.error(e?.message || '更新失败');
    }
  };

  const columns = [
    {
      colKey: 'summary',
      title: '线索摘要',
      minWidth: 260,
      cell: ({ row }: { row: Lead }) => (
        <div>
          <div style={{ color: 'var(--td-text-color-primary)', fontWeight: 500 }}>{row.summary}</div>
          <div className="mt-1" style={{ color: 'var(--td-text-color-secondary)', fontSize: '12px' }}>
            {row.need}
          </div>
        </div>
      ),
    },
    {
      colKey: 'contact',
      title: '联系人',
      width: 170,
      cell: ({ row }: { row: Lead }) => (
        <div>
          <div>{row.name || '未留称呼'}</div>
          <div style={{ color: 'var(--td-text-color-placeholder)', fontSize: '12px' }}>{row.contact || '未留联系方式'}</div>
        </div>
      ),
    },
    { colKey: 'budget', title: '预算', width: 120, cell: ({ row }: { row: Lead }) => row.budget || '未说明' },
    { colKey: 'timeline', title: '时间', width: 130, cell: ({ row }: { row: Lead }) => row.timeline || '未说明' },
    { colKey: 'priority', title: '优先级', width: 90, cell: ({ row }: { row: Lead }) => priorityTag(row.priority) },
    { colKey: 'status', title: '状态', width: 100, cell: ({ row }: { row: Lead }) => statusTag(row.status) },
    {
      colKey: 'createdAt',
      title: '创建时间',
      width: 170,
      cell: ({ row }: { row: Lead }) => new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false }),
    },
    {
      colKey: 'op',
      title: '操作',
      width: 190,
      fixed: 'right',
      cell: ({ row }: { row: Lead }) => (
        <Space>
          <Select
            size="small"
            value={row.status}
            options={STATUS_OPTIONS}
            style={{ width: 90 }}
            onChange={(v) => updateLeadStatus(row.id, v as string)}
          />
          <Button size="small" variant="text" theme="primary" onClick={() => navigate(`/admin/sessions/${row.sessionId}`)}>
            看对话
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
            线索池
          </h2>
          <p className="mt-1" style={{ color: 'var(--td-text-color-secondary)', fontSize: '13px' }}>
            自动沉淀合作咨询、项目需求和高价值跟进对象。
          </p>
        </div>
        <Button icon={<RefreshIcon />} variant="outline" onClick={fetchLeads}>
          刷新
        </Button>
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <span style={{ color: 'var(--td-text-color-secondary)', fontSize: '14px' }}>状态：</span>
          <Select
            value={statusFilter || undefined}
            onChange={(v) => { setStatusFilter(v as string); setPage(1); }}
            clearable
            placeholder="全部状态"
            style={{ width: 140 }}
            options={STATUS_OPTIONS}
          />
          <Input
            value={keyword}
            onChange={(v) => setKeyword(v as string)}
            placeholder="搜索需求、摘要、联系人"
            clearable
            style={{ width: 260 }}
            onEnter={() => { setPage(1); fetchLeads(); }}
            suffixIcon={<SearchIcon />}
          />
          <Button theme="primary" onClick={() => { setPage(1); fetchLeads(); }}>
            查询
          </Button>
          <span style={{ color: 'var(--td-text-color-placeholder)', fontSize: '13px' }}>
            共 {total} 条
          </span>
        </div>
      </Card>

      <Card>
        <Table
          data={leads}
          columns={columns as any}
          loading={loading}
          rowKey="id"
          hover
          stripe
        />
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
