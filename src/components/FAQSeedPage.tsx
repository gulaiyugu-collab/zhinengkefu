import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Tag, Button, Card, Input, Select, Dialog, Form,
  Textarea, MessagePlugin, Popconfirm, Space,
} from 'tdesign-react';
import {
  AddIcon, EditIcon, DeleteIcon, SearchIcon, ArrowLeftIcon, DownloadIcon,
} from 'tdesign-icons-react';
import { APP_CONFIG } from '../config';
import { FAQ, FaqCategory } from '../types';

const CATEGORY_OPTIONS = [
  { label: '个人介绍', value: 'profile' },
  { label: '服务范围', value: 'service' },
  { label: '案例经验', value: 'case' },
  { label: '报价边界', value: 'pricing' },
  { label: '交付流程', value: 'process' },
  { label: '合作边界', value: 'boundary' },
  { label: '退款', value: 'refund' },
  { label: '订单查询', value: 'order_query' },
  { label: '技术支持', value: 'tech_support' },
  { label: '通用', value: 'general' },
];

const categoryTag = (cat: FaqCategory | string) => {
  const map: Record<string, { color: string; label: string }> = {
    profile: { color: 'primary', label: '个人介绍' },
    service: { color: 'success', label: '服务范围' },
    case: { color: 'warning', label: '案例经验' },
    pricing: { color: 'danger', label: '报价边界' },
    process: { color: 'primary', label: '交付流程' },
    boundary: { color: 'default', label: '合作边界' },
    refund: { color: 'error', label: '退款' },
    order_query: { color: 'primary', label: '订单查询' },
    tech_support: { color: 'warning', label: '技术支持' },
    general: { color: 'default', label: '通用' },
  };
  const c = map[cat] || map.general;
  return <Tag theme={c.color as any} variant="light">{c.label}</Tag>;
};

interface FaqForm {
  category: FaqCategory;
  question: string;
  answer: string;
  keywords: string;
}

const EMPTY_FORM: FaqForm = {
  category: 'service',
  question: '',
  answer: '',
  keywords: '',
};

/**
 * FAQ 知识库管理页
 *
 * 功能：
 * - 列表展示 + 按分类筛选 + 关键词搜索
 * - 新增 / 编辑 / 删除 FAQ
 * - 检索测试（调用 FTS5 全文检索接口）
 * - 一键导入示例数据
 */
export function FAQSeedPage() {
  const navigate = useNavigate();

  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [loading, setLoading] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  // 新增/编辑弹窗
  const [dialogVisible, setDialogVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FaqForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // 检索测试
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FAQ[]>([]);

  const fetchFaqs = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/faq');
      const data = await resp.json();
      let list: FAQ[] = data.faqs || [];
      if (categoryFilter) {
        list = list.filter(f => f.category === categoryFilter);
      }
      setFaqs(list);
    } catch (e) {
      console.error('Fetch FAQ error:', e);
      MessagePlugin.error('加载 FAQ 列表失败');
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => {
    fetchFaqs();
  }, [fetchFaqs]);

  // 打开新增弹窗
  const handleAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogVisible(true);
  };

  // 打开编辑弹窗
  const handleEdit = (faq: FAQ) => {
    setEditingId(faq.id);
    setForm({
      category: faq.category,
      question: faq.question,
      answer: faq.answer,
      keywords: faq.keywords,
    });
    setDialogVisible(true);
  };

  // 保存（新增或编辑）
  const handleSave = async () => {
    if (!form.question.trim()) {
      MessagePlugin.warning('请填写问题');
      return;
    }
    if (!form.answer.trim()) {
      MessagePlugin.warning('请填写答案');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        category: form.category,
        question: form.question.trim(),
        answer: form.answer.trim(),
        keywords: form.keywords.trim(),
      };
      if (editingId) {
        const resp = await fetch(`/api/faq/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || '更新失败');
        MessagePlugin.success('FAQ 已更新');
      } else {
        const resp = await fetch('/api/faq', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || '新增失败');
        MessagePlugin.success('FAQ 已新增');
      }
      setDialogVisible(false);
      fetchFaqs();
    } catch (e: any) {
      MessagePlugin.error(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  // 删除
  const handleDelete = async (id: string) => {
    try {
      const resp = await fetch(`/api/faq/${id}`, { method: 'DELETE' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || '删除失败');
      MessagePlugin.success('已删除');
      fetchFaqs();
    } catch (e: any) {
      MessagePlugin.error(e?.message || '删除失败');
    }
  };

  // 检索测试
  const handleSearchTest = async () => {
    if (!searchQuery.trim()) {
      MessagePlugin.warning('请输入检索关键词');
      return;
    }
    try {
      const resp = await fetch(`/api/faq/search?q=${encodeURIComponent(searchQuery.trim())}`);
      const data = await resp.json();
      setSearchResults(data.results || []);
    } catch (e) {
      MessagePlugin.error('检索失败');
    }
  };

  // 一键导入示例数据
  const handleSeed = async () => {
    try {
      const resp = await fetch('/api/seed', { method: 'POST' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || '导入失败');
      MessagePlugin.success(`已导入 ${data.faqsInserted || 0} 条 FAQ、${data.ordersInserted || 0} 条示例订单`);
      fetchFaqs();
    } catch (e: any) {
      MessagePlugin.error(e?.message || '导入示例数据失败');
    }
  };

  const faqColumns = [
    { colKey: 'question', title: '问题', minWidth: 220, ellipsis: true },
    {
      colKey: 'category',
      title: '分类',
      width: 110,
      cell: ({ row }: { row: FAQ }) => categoryTag(row.category),
    },
    { colKey: 'answer', title: '答案', minWidth: 280, ellipsis: true },
    { colKey: 'keywords', title: '关键词', width: 180, ellipsis: true },
    {
      colKey: 'updatedAt',
      title: '更新时间',
      width: 160,
      cell: ({ row }: { row: FAQ }) => new Date(row.updatedAt).toLocaleString('zh-CN', { hour12: false }),
    },
    {
      colKey: 'op',
      title: '操作',
      width: 130,
      fixed: 'right',
      cell: ({ row }: { row: FAQ }) => (
        <Space>
          <Button
            size="small"
            variant="text"
            theme="primary"
            icon={<EditIcon />}
            onClick={() => handleEdit(row)}
          >
            编辑
          </Button>
          <Popconfirm
            content="确认删除此 FAQ？"
            onConfirm={() => handleDelete(row.id)}
          >
            <Button
              size="small"
              variant="text"
              theme="danger"
              icon={<DeleteIcon />}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="flex h-screen w-screen" style={{ backgroundColor: 'var(--td-bg-color-page)' }}>
      {/* 左侧导航 */}
      <aside
        className="flex flex-col flex-shrink-0 w-56 border-r"
        style={{
          backgroundColor: 'var(--td-bg-color-container)',
          borderColor: 'var(--td-component-border)',
        }}
      >
        <div className="h-14 px-4 flex items-center gap-2 border-b" style={{ borderColor: 'var(--td-component-border)' }}>
          <div
            className="w-7 h-7 rounded flex items-center justify-center"
            style={{ backgroundColor: 'var(--td-brand-color)' }}
          >
            <span className="text-white text-xs font-bold">{APP_CONFIG.nameInitial}</span>
          </div>
          <span style={{ color: 'var(--td-text-color-primary)', fontWeight: 600 }}>
            {APP_CONFIG.name}·知识库
          </span>
        </div>
        <div className="p-3">
          <Button
            icon={<DownloadIcon />}
            onClick={handleSeed}
            block
            theme="primary"
            variant="outline"
          >
            导入示例数据
          </Button>
        </div>
        <div className="flex-1" />
        <div className="p-3 border-t" style={{ borderColor: 'var(--td-component-border)' }}>
          <Button
            icon={<ArrowLeftIcon />}
            onClick={() => navigate('/')}
            block
            variant="text"
          >
            返回客服端
          </Button>
        </div>
      </aside>

      {/* 主内容区 */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold" style={{ color: 'var(--td-text-color-primary)' }}>
            FAQ 知识库管理
          </h2>
          <Button icon={<AddIcon />} theme="primary" onClick={handleAdd}>
            新增 FAQ
          </Button>
        </div>

        {/* 筛选区 */}
        <Card className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--td-text-color-secondary)', fontSize: '14px' }}>分类：</span>
              <Select
                value={categoryFilter || undefined}
                onChange={(v) => setCategoryFilter(v as string)}
                clearable
                placeholder="全部分类"
                style={{ width: 140 }}
                options={CATEGORY_OPTIONS}
              />
            </div>
            <span style={{ color: 'var(--td-text-color-placeholder)', fontSize: '13px' }}>
              共 {faqs.length} 条
            </span>
          </div>
        </Card>

        {/* FAQ 列表 */}
        <Card className="mb-4">
          <Table
            data={faqs}
            columns={faqColumns as any}
            loading={loading}
            rowKey="id"
            hover
            stripe
          />
        </Card>

        {/* 检索测试 */}
        <Card>
          <h3 className="text-base font-medium mb-3" style={{ color: 'var(--td-text-color-primary)' }}>
            检索测试（FTS5 全文检索）
          </h3>
          <div className="flex items-center gap-2 mb-4">
            <Input
              value={searchQuery}
              onChange={(v) => setSearchQuery(v as string)}
              placeholder="输入问题关键词，测试 FAQ 检索效果"
              clearable
              style={{ flex: 1, maxWidth: 480 }}
              onEnter={handleSearchTest}
              suffixIcon={<SearchIcon />}
            />
            <Button theme="primary" onClick={handleSearchTest}>
              检索
            </Button>
          </div>
          {searchResults.length > 0 && (
            <div className="space-y-2">
              {searchResults.map((faq, idx) => (
                <div
                  key={faq.id}
                  className="p-3 rounded-lg border"
                  style={{
                    borderColor: 'var(--td-component-border)',
                    backgroundColor: 'var(--td-bg-color-container)',
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="px-1.5 py-0.5 rounded text-xs"
                      style={{
                        backgroundColor: 'var(--td-brand-color-light)',
                        color: 'var(--td-brand-color)',
                      }}
                    >
                      #{idx + 1} · {(faq as any).score?.toFixed(3) || '-'}
                    </span>
                    {categoryTag(faq.category)}
                  </div>
                  <p style={{ color: 'var(--td-text-color-primary)', fontWeight: 500, marginBottom: '4px' }}>
                    {faq.question}
                  </p>
                  <p style={{ color: 'var(--td-text-color-secondary)', fontSize: '13px' }}>
                    {faq.answer}
                  </p>
                </div>
              ))}
            </div>
          )}
          {searchResults.length === 0 && searchQuery && (
            <p style={{ color: 'var(--td-text-color-placeholder)', fontSize: '14px' }}>
              点击「检索」按钮查看结果
            </p>
          )}
        </Card>
      </main>

      {/* 新增/编辑弹窗 */}
      <Dialog
        visible={dialogVisible}
        onClose={() => setDialogVisible(false)}
        header={editingId ? '编辑 FAQ' : '新增 FAQ'}
        width={560}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDialogVisible(false)} disabled={saving}>
              取消
            </Button>
            <Button theme="primary" onClick={handleSave} loading={saving}>
              保存
            </Button>
          </div>
        }
      >
        <Form labelAlign="top" className="pt-2">
          <Form.FormItem label="分类" name="category">
            <Select
              value={form.category}
              onChange={(v) => setForm({ ...form, category: v as FaqCategory })}
              options={CATEGORY_OPTIONS}
              style={{ width: '100%' }}
            />
          </Form.FormItem>
          <Form.FormItem label="问题" name="question">
            <Input
              value={form.question}
              onChange={(v) => setForm({ ...form, question: v as string })}
              placeholder="用户可能问的问题，如：如何申请退款？"
              maxlength={200}
            />
          </Form.FormItem>
          <Form.FormItem label="答案" name="answer">
            <Textarea
              value={form.answer}
              onChange={(v) => setForm({ ...form, answer: v as string })}
              placeholder="对应的标准答案"
              autosize={{ minRows: 4, maxRows: 8 }}
              maxlength={1000}
            />
          </Form.FormItem>
          <Form.FormItem label="关键词" name="keywords">
            <Input
              value={form.keywords}
              onChange={(v) => setForm({ ...form, keywords: v as string })}
              placeholder="用空格分隔，如：退款 退货 退钱，用于 FTS5 检索"
              maxlength={200}
            />
          </Form.FormItem>
        </Form>
      </Dialog>
    </div>
  );
}
