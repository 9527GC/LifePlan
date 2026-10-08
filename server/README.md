# LifePlan 反馈服务

该服务接收桌面端反馈、写入 PostgreSQL，并通过 Resend 向 `695971316@qq.com` 发送通知邮件。截图会作为邮件附件发送；当前版本数据库仅保存截图元数据，后续可迁移到对象存储。

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
