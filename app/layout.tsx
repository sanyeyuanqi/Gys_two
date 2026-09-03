import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GYS 供应商管理系统',
  description: '供应商 API 密钥、渠道、用量和子账号的一站式管理后台。',
  icons: { icon: '/favicon.svg' },
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
