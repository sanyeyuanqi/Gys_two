# GYS 供应商系统（后台中转版）

这个站点保留原 GYS 的业务数据与账号体系，但浏览器不再直接请求原站。
所有登录、渠道、用量、子账号与开放 API 请求均先进入本站后台，再由后台访问
`https://gys.oljuxj.xyz`。

## 数据边界

- 原 GYS 是唯一业务数据源。
- 本地 D1 只保存后台会话、原站 Cookie 和限流计数。
- 不在本站数据库复制渠道、用量、子账号或 API Key 业务记录。
- 不保存用户密码；原站会话失效后需要重新登录。

## 本地运行

```bash
npm install
npm run db:local
npm run dev
```

登录时请使用原 GYS 账号。

## 质量检查

```bash
npm run lint
npx tsc --noEmit
npm run build
```
