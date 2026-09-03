# GYS 供应商管理系统

一个可独立运行的供应商 API 密钥与渠道管理后台，包含：

- 管理员与供应商子账号登录
- 单个/批量密钥上传、自动去重和脱敏展示
- 渠道查询、启停、测试、删除与消费统计
- 子账号创建与权限隔离
- 可撤销、可限定权限的开放 API Key
- D1/SQLite 持久化与操作审计
- 桌面端、平板和手机端自适应布局

## 本地运行

```bash
npm install
npm run db:local
npm run dev
```

首次登录会自动创建演示数据：

- 管理员：`admin` / `admin123`
- 子账号：`supplier_demo` / `sub123`

正式使用前请在右上角账号菜单中修改管理员密码。

## 质量检查

```bash
npm run lint
npx tsc --noEmit
npm run build
```
