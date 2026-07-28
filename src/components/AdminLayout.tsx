import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Button } from 'tdesign-react';
import { ChatIcon, ChartIcon, ArrowLeftIcon, UserTalkIcon } from 'tdesign-icons-react';
import { APP_CONFIG } from '../config';

/**
 * 管理后台布局
 *
 * 顶部导航栏 + 左侧菜单：
 * - 对话列表 (/admin)
 * - 满意度统计 (/admin/stats)
 * - 返回客服端 (/)
 */
export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { path: '/admin', label: '对话列表', icon: <ChatIcon /> },
    { path: '/admin/leads', label: '线索池', icon: <UserTalkIcon /> },
    { path: '/admin/stats', label: '满意度统计', icon: <ChartIcon /> },
  ];

  const isActive = (path: string) => {
    if (path === '/admin') {
      return location.pathname === '/admin' || location.pathname.startsWith('/admin/sessions');
    }
    return location.pathname === path;
  };

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
        {/* Logo 区 */}
        <div className="h-14 px-4 flex items-center gap-2 border-b" style={{ borderColor: 'var(--td-component-border)' }}>
          <div
            className="w-7 h-7 rounded flex items-center justify-center"
            style={{ backgroundColor: 'var(--td-brand-color)' }}
          >
            <span className="text-white text-xs font-bold">{APP_CONFIG.nameInitial}</span>
          </div>
          <span style={{ color: 'var(--td-text-color-primary)', fontWeight: 600 }}>
            {APP_CONFIG.name}·管理后台
          </span>
        </div>

        {/* 菜单 */}
        <nav className="flex-1 p-3 space-y-1">
          {menuItems.map(item => (
            <div
              key={item.path}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
              style={{
                backgroundColor: isActive(item.path) ? 'var(--td-brand-color-light)' : 'transparent',
                color: isActive(item.path) ? 'var(--td-brand-color)' : 'var(--td-text-color-secondary)',
              }}
              onClick={() => navigate(item.path)}
              onMouseEnter={e => {
                if (!isActive(item.path)) e.currentTarget.style.backgroundColor = 'var(--td-bg-color-component-hover)';
              }}
              onMouseLeave={e => {
                if (!isActive(item.path)) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>{item.icon}</span>
              <span className="text-sm">{item.label}</span>
            </div>
          ))}
        </nav>

        {/* 底部返回按钮 */}
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
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
