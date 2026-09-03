# GYS 供应商系统（FastAPI 后台版）

这个站点保留原 GYS 的业务数据与账号体系，但浏览器不再直接请求原站。
所有登录、渠道、用量、子账号与开放 API 请求均先进入 FastAPI 后台，再由后台访问
`https://gys.oljuxj.xyz`。前端的 `/api` 路由只是连接 FastAPI 的同源转发层。

## 数据边界

- 原 GYS 是唯一业务数据源。
- FastAPI 使用本地 SQLite，只保存后台会话、原站 Cookie 和限流计数。
- 不在本地数据库复制渠道、用量、子账号或 API Key 业务记录。
- 不保存用户密码；原站会话失效后需要重新登录。

## 本地运行

```bash
npm install
npm run setup:backend
npm run dev
```

`npm run dev` 会同时启动：

- FastAPI：`http://127.0.0.1:8000`（接口文档：`/backend/docs`）
- 前端：默认 `http://localhost:3000`；端口占用时会自动顺延

登录时请使用原 GYS 账号。会话数据库保存在 `.gys-backend/`，不会提交到 Git。

## 单独启动

```bash
npm run dev:api
npm run dev:web
```

线上部署前需要把 FastAPI 部署到可访问的 Python 服务器，并设置
`GYS_FASTAPI_ORIGIN`；Sites 本身只托管前端转发层，不能运行 Python 进程。

## 质量检查

```bash
npm run lint
npx tsc --noEmit
npm run build
```
