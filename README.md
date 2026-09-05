# GYS 供应商系统（FastAPI 后台版）

这个站点保留原 GYS 的业务数据与账号体系，但浏览器不再直接请求原站。
所有登录、渠道、用量、子账号与开放 API 请求均先进入 FastAPI 后台，再由后台访问
`https://gys.oljuxj.xyz`。前端的 `/api` 路由只是连接 FastAPI 的同源转发层。

## 数据边界

- 原 GYS 是唯一业务数据源。
- FastAPI 使用 PostgreSQL，保存后台会话、原站 Cookie、账号映射、汇率与结算记录。原站 Cookie 使用独立密钥加密后入库，不通过业务接口返回。
- 不在本地数据库复制渠道、用量、子账号或 API Key 业务记录。
- 不保存原 GYS 用户密码；原站会话失效后需要重新登录。
- 系统内置本地超级管理员 `sanyeAdmin`，数据库仅保存其带盐密码哈希。该账号只可管理用户映射、公告并查看模型缺口缓存，不具备渠道或密钥操作权限。
- 超级管理员的用户映射入口支持新增管理员或子账号映射，两种类型都必须填写 GYS 用户 ID；登录时校验账号类型和该 ID。现有内部类型 `primary` 保持兼容，界面显示为“管理员”。已有映射可编辑，账号类型保持不变。
- 子账号只能登录管理员账号后，在“子账号”中新增；创建成功时自动按 GYS 用户名建立登录映射并记录返回的 ID，可直接使用该用户名和密码登录本站。查看子账号不会自动创建映射。
- 管理员验证成功后直接登录，同时在后台拉取其 GYS 子账号并补齐缺失的用户映射，记录用户名、显示名、ID 和启停状态；已有映射（包括自定义登录名及停用设置）保留，同名或 ID 冲突不会覆盖其他账号。后台同步失败不阻止登录、不清理登录状态，也不向用户显示同步失败提示；下次登录会再次尝试补齐。

首次启动前，必须在本地 `.env` 中设置 `SUPER_ADMIN_INITIAL_PASSWORD`。该值只用于首次创建超级管理员，数据库已有账号后不会覆盖当前密码。登录后应立即通过右上角账号菜单修改初始密码。

## 本地运行

请先启动 Docker Desktop，然后执行：

```bash
npm install
npm run setup:backend
npm run dev
```

`npm run dev` 会启动 PostgreSQL，并同时运行：

- PostgreSQL：`127.0.0.1:5433`
- FastAPI：`http://127.0.0.1:8000`（接口文档：`/backend/docs`）
- 前端：默认 `http://localhost:3000`；端口占用时会自动顺延

数据库默认连接地址为：

```text
postgresql://gys:gys_local_password@127.0.0.1:5433/gys
```

如需自定义账号、密码或端口，请复制 `.env.example` 为 `.env` 并修改对应变量。
PostgreSQL 数据保存在 Docker 数据卷 `gys_postgres_data` 中，停止应用后仍会保留。

本地未配置 `SESSION_COOKIE_ENCRYPTION_KEY` 时，系统会在忽略提交的
`.gys-backend/session-cookie.key` 中自动生成独立密钥。该文件用于解密仍有效的登录会话，
请勿在会话有效期间删除。

如果项目原来使用过 SQLite，可在 PostgreSQL 启动后执行一次：

```bash
npm run db:migrate
```

迁移会读取 `.gys-backend/sessions.sqlite3`，保留原文件并把账号映射、汇率、结算记录和仍有效的登录会话复制到 PostgreSQL。重复执行不会生成重复记录。旧 SQLite 文件可能仍含明文会话 Cookie；确认迁移结果后，请手动删除该文件或转移到加密备份。

## 单独启动

```bash
npm run db:start
npm run dev:api
npm run dev:web
```

停止数据库：

```bash
npm run db:stop
```

## 服务器 Docker 部署

服务器准备好 Docker 与外部网络 `gys-network` 后，在项目根目录创建 `.env`：

```env
POSTGRES_PASSWORD=请设置独立的强密码
GYS_PUBLIC_ORIGIN=https://你的域名
SUPER_ADMIN_INITIAL_PASSWORD=请设置独立的初始密码
SESSION_COOKIE_ENCRYPTION_KEY=请填入生成的Fernet密钥
```

可用下面的命令生成 Cookie 加密密钥；同一部署的所有后台进程必须使用同一个值：

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

然后执行：

```bash
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build --wait
```

部署会创建 `gys-postgres`、`gys-backend` 和 `gys-frontend` 三个容器；PostgreSQL
数据持久化在 `/data/gys-system/postgres`。Nginx 只需在 `gys-network` 中转发到
`gys-frontend:3000`。

前端通过 `gys-network` 内部网络访问 FastAPI，PostgreSQL 不暴露公网端口。

## 质量检查

```bash
npm run lint
npx tsc --noEmit
npm run build
```
