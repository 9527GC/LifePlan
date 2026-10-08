# LifePlan 反馈服务

该服务接收用户主动从桌面端提交的问题反馈，将反馈写入 PostgreSQL，并通过 Resend 向配置的收件地址发送通知邮件。反馈中的截图和可选的脱敏操作日志会作为邮件附件发送；数据库仅保存附件名称和 MIME 类型等元数据，不保存附件二进制内容。

## 接口行为与隐私

- `POST /api/feedback` 接收 `bug`、`suggestion`、`question` 或 `other` 四类反馈。
- 客户端最多添加 5 张图片（单张不超过 5 MB）；若用户勾选诊断信息，客户端会额外附带 1 个不超过 2 MB 的 JSON 操作日志，因此服务端最多处理 6 个附件。
- `includeDiagnostics` 仅在值为 `true` 时，服务端才会保存并邮件展示当前页面、应用版本、平台、用户代理和客户端时间。未勾选时，这些字段不写入数据库。
- 联系方式、截图和诊断信息均由用户自行选择是否提交。服务端不应将附件正文写入日志。

## 服务器部署

1. 在服务器克隆仓库并进入 `server` 目录。
2. 从 `.env.example` 创建 `.env`，设置一个强数据库密码及 Resend API Key。`.env` 不可提交到 Git。
3. 启动服务：

```bash
docker compose up -d --build
```

4. 确认状态：

```bash
docker compose ps
curl http://127.0.0.1:3100/health
```

Nginx 应将 `https://api.lifeplan.gc9527.com` 反向代理到 `http://127.0.0.1:3100`，并配置 HTTPS。

## 环境变量

```env
POSTGRES_PASSWORD=请使用一段随机的长密码
RESEND_API_KEY=re_请在服务器上填写实际密钥
FEEDBACK_TO_EMAIL=695971316@qq.com
FEEDBACK_FROM_EMAIL=feedback@lifeplan.gc9527.com
HOST=0.0.0.0
PORT=3100
```
