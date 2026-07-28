/**
 * 客服知识库种子数据
 *
 * 覆盖三个意图分类：
 * - refund（退款）：4 条
 * - order_query（订单查询）：4 条
 * - tech_support（技术支持）：3 条
 *
 * 外加 4 条模拟订单数据，用于 query_order 工具演示。
 */

import { v4 as uuidv4 } from 'uuid';
import * as db from './db.js';

export interface FaqSeed {
  id: string;
  category: string;
  question: string;
  answer: string;
  keywords: string;
}

export const FAQ_SEED_DATA: FaqSeed[] = [
  // ===== 退款类 (refund) =====
  {
    id: 'faq-001',
    category: 'refund',
    question: '如何申请退款？',
    answer: '在订单完成后7天内，您可以进入"我的订单"页面，找到对应订单点击"申请退款"，选择退款原因并提交。退款将在3-5个工作日内原路退回。',
    keywords: '退款,退货,refund,退钱,申请退款',
  },
  {
    id: 'faq-002',
    category: 'refund',
    question: '退款多久到账？',
    answer: '退款审核通过后，款项将在3-5个工作日内原路退回您的支付账户。如超过7个工作日未到账，请联系人工客服查询。',
    keywords: '退款到账,退款时间,退款多久,refund time',
  },
  {
    id: 'faq-003',
    category: 'refund',
    question: '哪些情况不支持退款？',
    answer: '以下情况不支持退款：1) 超过7天退款期限；2) 商品已拆封使用且影响二次销售；3) 定制类商品已开始生产；4) 虚拟商品已使用。如有争议可转人工处理。',
    keywords: '不能退款,不支持退款,退款条件,退款限制',
  },
  {
    id: 'faq-004',
    category: 'refund',
    question: '退货运费谁承担？',
    answer: '质量问题导致的退货，运费由我方承担；非质量问题（如不喜欢、尺码不合适）的退货，运费由买家承担。退货运费将在退款中一并处理。',
    keywords: '退货运费,运费,退货邮费,shipping refund',
  },

  // ===== 订单查询类 (order_query) =====
  {
    id: 'faq-005',
    category: 'order_query',
    question: '如何查看订单状态？',
    answer: '您可以登录账号，进入"我的订单"页面查看所有订单的实时状态。也可以提供订单号，我帮您查询。',
    keywords: '订单状态,查订单,订单查询,物流,order status',
  },
  {
    id: 'faq-006',
    category: 'order_query',
    question: '订单发货后多久能收到？',
    answer: '一般情况下：同城1-2天，省内2-3天，跨省3-5天。偏远地区可能需要5-7天。您可在订单详情中查看物流跟踪信息。',
    keywords: '发货时间,到货时间,物流时效,快递,delivery time',
  },
  {
    id: 'faq-007',
    category: 'order_query',
    question: '可以修改收货地址吗？',
    answer: '订单未发货前可以修改收货地址，请在"我的订单"中点击"修改地址"。如已发货则无法修改，建议联系快递公司拦截或转人工处理。',
    keywords: '修改地址,改地址,收货地址,address change',
  },
  {
    id: 'faq-008',
    category: 'order_query',
    question: '如何取消订单？',
    answer: '未付款订单可直接取消。已付款未发货的订单，可在"我的订单"中申请取消，系统自动退款。已发货订单无法直接取消，需收到后申请退货退款。',
    keywords: '取消订单,撤销订单,cancel order',
  },

  // ===== 技术支持类 (tech_support) =====
  {
    id: 'faq-009',
    category: 'tech_support',
    question: 'APP登录不了怎么办？',
    answer: '请尝试以下步骤：1) 检查网络连接是否正常；2) 清除APP缓存后重试；3) 确认账号密码正确，可使用"忘记密码"重置；4) 如仍无法登录，请卸载重装最新版本。问题持续可转人工。',
    keywords: '登录不了,无法登录,登录失败,login error,登不上去',
  },
  {
    id: 'faq-010',
    category: 'tech_support',
    question: '支付失败怎么处理？',
    answer: '支付失败常见原因：1) 余额不足；2) 银行卡限额；3) 网络超时。建议：更换支付方式重试，或检查银行卡状态。如多次失败请联系人工客服排查。',
    keywords: '支付失败,付款失败,无法支付,payment failed',
  },
  {
    id: 'faq-011',
    category: 'tech_support',
    question: '页面加载缓慢/白屏怎么办？',
    answer: '请尝试：1) 清除浏览器缓存；2) 切换网络（WiFi/4G）；3) 关闭不必要的浏览器插件；4) 使用 Chrome 最新版。如问题持续请联系人工客服并提供截图。',
    keywords: '加载慢,白屏,卡顿,页面错误,slow,blank',
  },
];

export interface OrderSeed {
  id: string;
  customer_name: string;
  status: string;
  total_amount: number;
  items: string;
  created_at: string;
  updated_at: string;
}

export const ORDER_SEED_DATA: OrderSeed[] = [
  {
    id: 'ORD-2024-001',
    customer_name: '张三',
    status: 'shipped',
    total_amount: 299.00,
    items: '[{"name":"无线耳机","qty":1,"price":299}]',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-16T08:00:00Z',
  },
  {
    id: 'ORD-2024-002',
    customer_name: '李四',
    status: 'delivered',
    total_amount: 1299.00,
    items: '[{"name":"智能手表","qty":1,"price":1299}]',
    created_at: '2024-01-10T14:00:00Z',
    updated_at: '2024-01-13T09:00:00Z',
  },
  {
    id: 'ORD-2024-003',
    customer_name: '王五',
    status: 'pending',
    total_amount: 89.00,
    items: '[{"name":"手机壳","qty":2,"price":44.5}]',
    created_at: '2024-01-20T16:00:00Z',
    updated_at: '2024-01-20T16:00:00Z',
  },
  {
    id: 'ORD-2024-004',
    customer_name: '赵六',
    status: 'cancelled',
    total_amount: 599.00,
    items: '[{"name":"蓝牙音箱","qty":1,"price":599}]',
    created_at: '2024-01-18T11:00:00Z',
    updated_at: '2024-01-18T15:00:00Z',
  },
];

/**
 * 注入种子数据
 * @returns { faqs: number, orders: number } 注入的条目数
 */
export function seedData(): { faqs: number; orders: number } {
  const now = new Date().toISOString();

  const faqs: db.DbFaq[] = FAQ_SEED_DATA.map(f => ({
    ...f,
    created_at: now,
    updated_at: now,
  }));

  const orders: db.DbOrder[] = ORDER_SEED_DATA;

  db.createFaqsBatch(faqs);
  db.createOrdersBatch(orders);

  console.log(`[Seed] 注入 ${faqs.length} 条 FAQ，${orders.length} 条订单`);
  return { faqs: faqs.length, orders: orders.length };
}
