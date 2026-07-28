import { useState } from 'react';
import { Dialog, Rate, Textarea, Button, MessagePlugin } from 'tdesign-react';
import { Session } from '../types';

interface RatingDialogProps {
  visible: boolean;
  session: Session | undefined;
  onClose: () => void;
  onSubmitSuccess?: () => void;
}

/**
 * 满意度评分弹窗
 *
 * 会话结束后弹出，用户可打 1-5 星 + 评语。
 * 提交后调用 POST /api/sessions/:id/rating，成功后将会话状态置为 resolved。
 */
export function RatingDialog({ visible, session, onClose, onSubmitSuccess }: RatingDialogProps) {
  const [score, setScore] = useState<number>(0);
  const [comment, setComment] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!session?.id) return;
    if (score < 1 || score > 5) {
      MessagePlugin.warning('请选择评分（1-5 星）');
      return;
    }
    setSubmitting(true);
    try {
      const resp = await fetch(`/api/sessions/${session.id}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, comment: comment.trim() || undefined }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        MessagePlugin.error(data.error || '提交评分失败');
        return;
      }
      MessagePlugin.success('感谢您的评价！');
      // 重置表单
      setScore(0);
      setComment('');
      onSubmitSuccess?.();
      onClose();
    } catch (e: any) {
      MessagePlugin.error(e?.message || '网络错误');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setScore(0);
    setComment('');
    onClose();
  };

  return (
    <Dialog
      visible={visible}
      onClose={handleClose}
      header="为本次服务评分"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            稍后评价
          </Button>
          <Button theme="primary" onClick={handleSubmit} loading={submitting}>
            提交评价
          </Button>
        </div>
      }
      width={420}
    >
      <div className="py-4">
        <div className="mb-4 text-center">
          <p style={{ color: 'var(--td-text-color-primary)', fontSize: '16px', marginBottom: '12px' }}>
            您对本次客服服务满意吗？
          </p>
          <Rate
            value={score}
            onChange={(v) => setScore(v as number)}
            size="28px"
            allowHalf={false}
            showText
            texts={['非常不满意', '不满意', '一般', '满意', '非常满意']}
          />
        </div>
        <div className="mt-4">
          <p style={{ color: 'var(--td-text-color-secondary)', fontSize: '13px', marginBottom: '8px' }}>
            评价内容（选填）：
          </p>
          <Textarea
            value={comment}
            onChange={(v) => setComment(v as string)}
            placeholder="请输入您的建议或反馈，帮助我们改进服务"
            autosize={{ minRows: 3, maxRows: 6 }}
            maxlength={300}
          />
        </div>
      </div>
    </Dialog>
  );
}
