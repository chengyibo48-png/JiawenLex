# JiawenLex：把待完成服务配置好

更新：2026-09-29。现有 Supabase 和 QQ SMTP 的连接检查通过。尚缺公开网站、个人 AI 服务、独立备份存储、备份数据库连接和真实恢复项目。

“配置齐全”只表示设置存在；“连接通过”表示服务接受了连接；“验收通过”需要实际完成邮件、AI 或恢复流程。这三个状态分开记录。

## 1. 先注册 Vercel，把网页部署出去

1. 打开 [Vercel 注册页面](https://vercel.com/signup)，用 **Continue with GitHub**，选择 `chengyibo48-png`。个人非商业试用选择 Hobby；如页面要求购买，先停在该页面核对选项。
2. 进入 **Add New → Project**，导入 `chengyibo48-png/JiawenLex`。如果找不到仓库，通过 GitHub 授权页面给 Vercel 访问这个仓库的权限。
3. Framework Preset 选择 **Next.js**；Root Directory 保持项目根目录。使用 Node.js 24（如可选），安装与构建保持框架默认值。
4. 展开 **Environment Variables**，逐项添加下面变量。值从本机 `D:\.codex\JiawenLex\.env.local` 复制到 Vercel；不要上传或提交整个文件。

| 变量 | 在哪里取值 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 现有 Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 现有公开 key |
| `SUPABASE_SECRET_KEY` | 现有服务端 secret key |
| `AI_KEY_ENCRYPTION_SECRET` | 本机已有值，保持相同 |
| `FILE_ACCESS_SECRET`、`CRON_SECRET` | 本机已有值 |
| `SMTP_HOST`、`SMTP_PORT`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM` | 本机已有 QQ SMTP 配置 |
| `NEXT_PUBLIC_DEMO_MODE` | 填 `false` |

第一次部署后记下 Vercel 分配的 **Production 网站根地址**，例如 `https://你的项目.vercel.app`。把它填到 Vercel 的 `NEXT_PUBLIC_SITE_URL`，再 **Redeploy**。本机的 `NEXT_PUBLIC_SITE_URL` 保留 localhost，方便本机登录回跳。不要把 `HTTP_PROXY`、`HTTPS_PROXY` 的本机代理地址添加到 Vercel。

5. Supabase → Authentication → URL Configuration：**Site URL** 填线上根地址；**Redirect URLs** 保留 `http://localhost:3000`，并添加线上根地址。代码的验证与密码恢复回跳目前使用根地址，不需要凭空添加其他路径。
6. 打开线上地址，用已有管理员账号登录，再检查验证/密码恢复链接是否回到正确的网站。

Vercel 的 GitHub 集成会部署后续提交，操作依据 [官方导入说明](https://vercel.com/docs/git/vercel-for-github)。Hobby 的用途限制和大陆访问情况见 [计划说明](https://vercel.com/docs/plans/hobby)、[大陆访问说明](https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china)。

## 2. 配置个人 AI 服务

API Key 相当于服务调用凭证，**不是登录密码**。在 JiawenLex 的“设置 → AI 服务与预算”中填写，服务端会加密保存。每位成员使用自己的密钥和预算。

### DeepSeek：用于文本反馈

1. 打开 [DeepSeek 开放平台](https://platform.deepseek.com/)，注册并登录。
2. 进入 **API Keys** 创建一个给 JiawenLex 使用的 key。是否需充值、充值金额由你在平台确认；本指南不承诺免费调用。
3. JiawenLex → 设置 → 文本反馈：服务商选 **DeepSeek**，把 key 填入 **API Key**，点“保存密钥”。
4. 设置月度预算，例如先设 `10` 元，再打开 AI 开关，点“保存 AI 开关与预算”。这是应用内的费用估算阈值，最终费用以平台账单为准。
5. 用一篇短作文主动提交一次，确认数据发送提示、批注和费用记录。普通学习功能可一直关闭 AI。

当前调用 `deepseek-flash`，以非思考模式生成 JSON 反馈。参考 [接口说明](https://api-docs.deepseek.com/api/create-chat-completion/)、[当前价格](https://api-docs.deepseek.com/quick_start/pricing/)。

### 阿里云百炼：用于录音转写，也可用于文本反馈

1. 注册并登录 [阿里云百炼](https://bailian.console.aliyun.com/)。按照控制台要求开通服务；如提示实名认证，由你在该平台完成。
2. **当前 JiawenLex 接入的是“华北2（北京）”**。在控制台选择该地域，进入 API Key 页面创建 key，并选择所属业务空间。北京以外的 key 不要填入当前接入方式。
3. 在业务空间管理页面复制 **Workspace ID**。它是空间编号，不能用 APP ID、账号 ID 或 API Key 替代。
4. JiawenLex → 设置 → 录音转写：填写该 Workspace ID 和 API Key，点“保存密钥”。文本服务如改用 Qwen，也在“文本反馈”框内分别保存这两项。
5. 录制一段约 10 秒的英语，选择是否保留录音，再确认发送进行转写。检查文字、反馈、预算提示以及默认不保存原音的行为。

步骤依据 [获取 key](https://help.aliyun.com/zh/model-studio/get-api-key/)、[获取 Workspace ID](https://help.aliyun.com/zh/model-studio/obtain-the-app-id-and-workspace-id)、[地域规则](https://help.aliyun.com/zh/model-studio/regions)。免费额度、模型权限和到期后的费用以你控制台显示为准。

## 3. 建独立私有备份存储

如果还没有存储，可以选 **Cloudflare R2 Standard**。它提供 S3 接口，当前 Standard 有每月 10 GB-month 存储免费额度，超出免费额度会计费；开通时是否需要绑定支付方式以页面为准。见 [价格](https://developers.cloudflare.com/r2/pricing/)。已有 OSS/COS 等存储也可继续使用，只需填写其 S3 兼容配置。

选择 R2 时：

1. 注册 [Cloudflare](https://dash.cloudflare.com/sign-up)，进入 **R2 Object Storage**，按页面开通。
2. 建名为 `jiawenlex-backups` 的 **Standard** bucket，保持私有；不启用 Public Development URL（r2.dev）或公开自定义域名。
3. 创建仅限定到该 bucket 的 **Object Read & Write** API token。保存生成的 **Access Key ID** 和 **Secret Access Key**。它们不是 Cloudflare 登录密码，也不是 Supabase key。
4. 在本机 `.env.local` 填：

```dotenv
BACKUP_S3_ENDPOINT=https://你的ACCOUNT_ID.r2.cloudflarestorage.com
BACKUP_S3_REGION=auto
BACKUP_S3_BUCKET=jiawenlex-backups
BACKUP_S3_ACCESS_KEY_ID=你的AccessKeyID
BACKUP_S3_SECRET_ACCESS_KEY=你的SecretAccessKey
```

`BACKUP_ENCRYPTION_SECRET` 已在本机生成，保留原值，并另存一份安全副本；丢失它就无法解密备份。不要给 `deletions/` 前缀设置自动到期删除规则：旧备份恢复时仍要读取这些删除记录。

5. 将上述六个 `BACKUP_*` 变量也添加到 **Vercel**，再部署，使注销、删除和撤销能写入外部删除记录。参考 [R2 key 与 endpoint](https://developers.cloudflare.com/r2/api/tokens/)、[私有 bucket](https://developers.cloudflare.com/r2/buckets/public-buckets/)。

## 4. 启用每周备份与每日任务

### 每周备份：在 GitHub 执行

1. Supabase 项目点击 **Connect**，选择 **Session pooler** 连接（非 Transaction pooler）。将完整连接串填入本机 `DATABASE_URL`，其中 PASSWORD 是 **数据库密码**，不是邮箱密码或 API Key；特殊字符需按连接串要求编码。
2. GitHub 仓库 → **Settings → Secrets and variables → Actions → New repository secret**，逐个填写：`DATABASE_URL`、`NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SECRET_KEY` 和六个 `BACKUP_*` 变量。数据库连接仅给备份工作机使用，无需放进浏览器或 Vercel。
3. GitHub → **Actions → Encrypted weekly backup → Run workflow**，观察是否成功。流程使用 PostgreSQL 17 客户端，备份后自动下载、解密并校验；校验成功后才保留最近四份已验证快照。
4. 保存第一次成功的时间与快照前缀，安排下面的真实恢复演练。GitHub 的定时任务可能延迟，应定期查看实际运行记录。

### 每日提醒与一年清理：在 Supabase 调度

网站、QQ SMTP、独立备份存储均就绪后：

1. 在 Supabase 启用 `pg_cron` 和 `pg_net`。
2. 在 Vault 添加 `jiawenlex_site_url`（线上根地址）和 `jiawenlex_cron_secret`（与 Vercel 的 `CRON_SECRET` 完全一致）。同名设置只留一份。
3. 在 SQL Editor 完整执行 `supabase/cron.sql`。它会拒绝 localhost、缺少配置或过短的 secret；同名任务再次执行会更新调度。
4. 在数据库的 `net._http_response` 查看响应码与是否超时。仅显示任务存在还不能证明邮件发送成功。
5. 在自己的 JiawenLex 设置里打开提醒，安排一个有待完成任务的时间，确认收到邮件。朋友的提醒保持各自主动开启。

调度超时已按路由的处理时间设为 65 秒；接口最多运行 60 秒。依据 [pg_net 接口](https://supabase.com/docs/guides/database/extensions/pg_net)。

## 5. 本机自检和真实恢复

在项目目录的终端执行：

```text
pnpm services:check
pnpm services:check --connect
```

第一条列出缺少的变量名和 PostgreSQL 工具。第二条另外验证 Supabase、SMTP 和已配置存储的连接；**不发送邮件，不调用 AI**。管理员的“小组管理 → 服务配置情况”也显示配置是否齐全。

本机备份需 PostgreSQL 17 客户端；只使用 GitHub 备份时，本机无需先安装。恢复演练的工作机需要 `pg_dump`、`pg_restore`、`psql`。

每月用一个全新的、可丢弃的 Supabase 项目演练，不对现有项目执行恢复：

1. 从成功备份记录取固定前缀，设置 `SNAPSHOT_PREFIX`。旧版只有 manifest 的快照须指定前缀先执行 verify，成功后才会列入已验证快照。
2. 在该新项目按顺序应用仓库全部数据库迁移，建立空表、权限和 Auth/Storage 钩子；不要初始化邀请码或注册用户。迁移版本须与所选快照结构相容。
3. 设置不同项目的 `RECOVERY_DATABASE_URL`、`RECOVERY_SUPABASE_URL`、`RECOVERY_SUPABASE_SECRET_KEY` 和 `RESTORE_CONFIRM=fresh-recovery-project`。保持源项目 `DATABASE_URL`、备份存储与解密设置不变。
4. 执行 `pnpm backup restore-database`，仅恢复应用表与 Auth users/identities 的数据，自动重放删除记录；再执行 `pnpm backup restore-files`。它不会重建 Supabase 托管 schema，也不导入旧会话、Vault 或 cron。目标不是独立项目、表中已有数据、备份缺表或导入失败时都会停止。后续删除记录有变化时，先再次执行 `pnpm backup replay-deletions`，再恢复文件。具体托管数据库约束参见 [官方恢复说明](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)。
5. 核对权限隔离、已注销账号、已删除资料、已撤销分享、过期作文/录音、统计摘要，以及保留授权的共享附件。恢复项目须重新登录；旧会话已清除。重新配置该项目专用的 Auth 回跳/SMTP，保持恢复项目与正式 cron 隔离。
6. 记录结果并销毁演练环境。若需单独下载明文 dump，设置 `RECOVERY_DUMP_PATH` 为私有目录里尚不存在的文件，执行 `pnpm backup download`，演练后清除该文件。完整性检查和本机数据库测试均不能代替这一步。

## 当前验收状态

| 项目 | 状态 |
| --- | --- |
| Supabase 连接与既有权限检查 | 已通过 |
| QQ SMTP 登录连接 | 已通过；本次未发送邮件 |
| 本机恢复逻辑与现有约束回归 | 已通过 |
| 个人 AI 文本／转写实际调用 | 待创建账号并在设置保存 key |
| 线上地址与定时任务 | 待创建 Vercel 项目并部署 |
| 独立加密备份、真实恢复演练 | 待存储、数据库连接及恢复项目 |
