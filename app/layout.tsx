import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PushKey系统',
  description: '使用原站账号登录的 API Key 上传与消耗管理系统。',
  icons: {
    icon: [{ url: '/favicon.svg?v=2', type: 'image/svg+xml' }],
    shortcut: '/favicon.svg?v=2',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
