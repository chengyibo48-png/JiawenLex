# JiawenLex

邀请制雅思备考工作台。首期支持 Academic 四科练习、词汇、计划、资料库、进度、草稿和可选的 AI 反馈；GT 用户可使用通用功能。资料库初始为空，不包含官方题库。`NEXT_PUBLIC_DEMO_MODE=true` 只用于本机体验，内有明确标注的自创示例。

## 本机启动

需要 Node.js 22 或更新版本、pnpm 11。运行 `pnpm install`，复制 `.env.example` 为 `.env.local`。若仅看演示，把 `NEXT_PUBLIC_DEMO_MODE=true` 留着，执行 `pnpm dev` 并打开 `http://localhost:3000`。演示数据存在当前浏览器，不连接 Supabase，也不模拟真实邮件、AI 或备份。

本机通过代理访问 Supabase 时，在 `.env.local` 填写 `HTTPS_PROXY`、`HTTP_PROXY`（例如 `http://127.0.0.1:7892`，端口以自己的代理为准），使用 Node.js 24 或更新版本。`pnpm dev` 会在启动 Next.js 前启用 Node 的环境代理；浏览器仍使用自己的网络设置。海外部署通常留空这两项。

## v1 修复与验证

执行 `pnpm test` 可在本机完成学习计划、答案判定、历史归档、加密草稿以及 PostgreSQL 权限回归测试。数据库测试使用 PGlite 内存实例，模拟 Auth/Storage 的表和角色，不连接真实账号，也不发送邮件。它不能代替真实 Supabase、AI 或备份恢复验收。

新增迁移 `20260928174339_v1_reliability.sql` 提供原子计划更新、会话撤销检查、AI 预算预留、长期统计摘要、附件归属约束和重复分享限制。已有环境须先审核并应用这份迁移，再完成真实数据库验收。应用前普通登录、草稿和练习记录兼容旧结构；重新生成计划与 AI 调用会显示更新待应用提示，保留现有内容。会话立即撤销和新增数据库约束在迁移成功后生效。

本轮修复清单及验证范围见 [v1 检查记录](docs/v1-review-2026-09-29.md)。

## 建立正式环境

1. 在 Supabase 新加坡区域建项目，在 SQL Editor 按文件名顺序完整执行 `supabase/migrations/` 内所有迁移。初始迁移为 `20260928163502_initial.sql`，随后执行 `20260928164246_harden_policy_execution.sql`。这些 SQL 建立表、最小访问授权、行级策略、私有 Storage bucket 和邀请码检查。已经执行过的迁移不要再次执行。
2. 在 `invite_control` 插入首个邀请码的 SHA-256。示例 SQL：`insert into public.invite_control(id, code_hash) values (1, encode(digest('请换成长随机邀请码', 'sha256'), 'hex'));`。请自行生成至少 12 字符的随机码，仅私下保存明文。第一位用该码注册的用户自动成为管理员，其预设目标为 7.5 / 2027-02-28 / 每周 10 小时；首次登录仍会显示目标设置。后续成员默认不带分数和日期。
3. 在 Supabase Auth 启用 **Confirm email**，将 **Site URL** 和允许的 **Redirect URLs** 设置为实际站点地址（本机为 `http://localhost:3000`）。建议在 Auth Hooks 启用 **Before User Created**，指向 `public.jiawenlex_before_user_created`，以返回清楚的邀请码错误。数据库还在 `auth.users` 的 INSERT 事务内强制验证邀请码和活动账号上限，即使尚未打开 Hook 也无法绕过邀请限制。保持匿名登录关闭。
4. 打开项目 **Settings → API Keys**，将 Publishable key 填入 `.env.local` 的 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`，将 Secret key 填入 `SUPABASE_SECRET_KEY`；项目 URL 填入 `NEXT_PUBLIC_SUPABASE_URL`。代码也兼容旧项目的 `SUPABASE_SERVICE_ROLE_KEY`。Secret key 仅用于服务端。为 Supabase Auth 配置外部 SMTP；同一 SMTP 可供每日提醒使用，并填写 `.env.local` 中的 SMTP 参数。填好密钥并执行迁移、初始化邀请码后，将 `NEXT_PUBLIC_DEMO_MODE=false`，重启开发服务器进入真实登录流程。
5. 配置独立的私有 S3 兼容存储和 `BACKUP_ENCRYPTION_SECRET`，并为部署环境填写相同变量。注销、删除、撤销分享以及一年清理在写入外部加密删除记录失败时会停止，避免恢复旧备份后复现已删数据。备份桶不能公开访问，也不能与 Supabase Storage 混用。
6. 生成长度至少 32 字符的独立 `AI_KEY_ENCRYPTION_SECRET`、`FILE_ACCESS_SECRET` 和 `CRON_SECRET`。用户的 AI 密钥在服务端以 AES-256-GCM 加密保存，浏览器只能读取服务商名称与是否已配置。
7. 在 Vercel 创建 Next.js 项目并填写环境变量，部署前确保 `NEXT_PUBLIC_DEMO_MODE=false`。免费试用地址可能在中国大陆访问不稳定；本项目没有为大陆访问作保证。Vercel Hobby 仅适用非商业个人用途。
8. 在 Supabase Vault 中保存 `jiawenlex_site_url`（正式网站根 URL）和 `jiawenlex_cron_secret`（与环境变量 `CRON_SECRET` 相同），启用 `pg_cron` 与 `pg_net`，再执行 `supabase/cron.sql`。提醒任务每 15 分钟检查时区与用户设定时间，且同一当地日期只发一次；清理任务每日处理一批超过一年的原始内容。邮件提醒默认关闭。
9. 将仓库放入 GitHub 后，在 Actions Secrets 中配置 `.github/workflows/backup.yml` 使用的数据库与备份变量。工作流每周生成数据库和文件的 AES-256-GCM 加密快照，并立即校验新快照；只保留最近 4 份完整快照。另需每月在独立恢复环境执行下面的恢复演练。

首次正式上线前，管理员应检查所有共享资料的来源与使用许可。普通成员不能审批自己的共享资料；管理员界面只读取待审核共享资料与成员名，不展示他人私有练习或 AI 密钥。

### QQ 邮箱配置

先在 QQ 邮箱设置中开启 SMTP 并取得客户端授权码。授权码用于 SMTP，不能填写 QQ 登录密码。按 [腾讯的邮件连接说明](https://main.qcloudimg.com/raw/document/product/pdf/1270_46586_cn.pdf)，普通 QQ 邮箱可使用 `smtp.qq.com` 和 SSL 端口 `465`。

在被 Git 忽略的 `.env.local` 填写：

```dotenv
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=你的完整QQ邮箱地址
SMTP_PASSWORD=QQ邮箱客户端授权码
SMTP_FROM=你的完整QQ邮箱地址
```

这些环境变量供网站发送提醒使用。注册验证和密码重设由 **Supabase Auth** 发送，还需要到项目 **Authentication → Emails → SMTP Settings** 打开 Custom SMTP，填写相同主机、端口、用户名、授权码和发件地址，发件人名称填 `JiawenLex`。只填本机文件不会改变 Supabase 邮件配置。项目的 Secret key 也不能修改 Auth 管理配置；该操作需要后台管理权限。保存后再验证收信和密码重设。参阅 [Supabase SMTP 说明](https://supabase.com/docs/guides/auth/auth-smtp)。

首次初始化生成的邀请码保存在 `.env.local` 的 `JIAWENLEX_INITIAL_INVITE_CODE`；数据库只保存其 SHA-256。该本机变量用于首次注册，管理员后续轮换邀请码时不会自动更新这份旧副本。请勿提交 `.env.local` 或把它放进公开附件。

### 数据隔离检查

`supabase/tests/access-control.sql` 可在全新、没有真实账号的测试项目执行。它在一个事务中检查邀请码、5 个活动账号上限、所有者隔离、管理员隔离、分享和评论、撤销及移除成员；最后回滚全部测试数据，不发送邮件。不要在已有真实账号的项目运行。

Supabase 顾问可能显示 `RLS Enabled No Policy`：邀请码、加密密钥、转写任务、提醒发送记录和删除记录这五张表刻意只允许服务端角色访问，成员没有访问授权或策略。这属于预期的拒绝访问配置。新数据库的索引也可能被标记为尚未使用，需积累实际工作负载后评估。

## 备份、验证与恢复演练

备份工作机需安装 PostgreSQL 客户端（`pg_dump`、`pg_restore`、`psql`），以及 Node.js 22。设置环境变量后运行：

```text
node scripts/backup.mjs backup
node scripts/backup.mjs verify
```

`backup` 上传加密的 PostgreSQL custom dump、两个私有 bucket 的文件和清单；最后上传清单作为完整快照标记。`verify` 下载并解密最近快照，逐个校验 SHA-256，检查数据库 dump 能被 `pg_restore` 读取。这是完整性验证，仍需要真实恢复演练。

每月在**全新的、可丢弃的恢复项目**中：先按 Supabase 的数据库恢复流程恢复最近的数据库快照；设置 `RECOVERY_DATABASE_URL` 和 `RESTORE_CONFIRM=fresh-recovery-project` 后运行 `node scripts/backup.mjs replay-deletions`；再设置 `RECOVERY_SUPABASE_URL`、`RECOVERY_SUPABASE_SECRET_KEY`（也兼容旧的 `RECOVERY_SUPABASE_SERVICE_ROLE_KEY`）并运行 `node scripts/backup.mjs restore-files`。恢复工具只上传数据库里仍被资料或未过期练习引用的文件。逐项核对已注销账号、已移除成员、撤销的分享、删除的资料/练习和满一年清除的原文及录音。不要把恢复项目公开。恢复成功后销毁该环境。

没有真实服务凭据时，无法在本机完成邮件、邀请钩子、AI 提供商账单和恢复演练。部署前必须实际演练一次，再把站点提供给朋友。免费 Supabase 项目可能因不活跃暂停，备份存储的免费额度也需在创建时核验。

## 技术与数据说明

- Next.js 16 / React 19 / Supabase Auth、PostgreSQL 与 Storage。浏览器直接访问的表都启用 RLS；管理员服务角色只用于经授权的 API 和维护任务。
- 写作草稿云端自动保存，离线时使用 IndexedDB 中不可导出的设备密钥加密暂存；并发修改用版本号检测。更换浏览器或清除站点数据会丢失尚未同步的本机副本。
- 录音默认不保留。可选保存的录音及原始作答/逐条反馈在一年后清除，练习统计保留。分享接收者只可查看与评论；附件请求每次检查当前授权，撤销后新请求会被拒绝。
- DeepSeek 文本模型使用 `deepseek-flash`；阿里云百炼文本使用 `qwen-plus`，转写使用 `paraformer-v2`。AI 可完全关闭；费用提示依据公开单价估算，最终金额以服务商账单为准。
- `pnpm typecheck` 检查 TypeScript，`pnpm build` 编译生产版本。项目未附带版权不明的代码或雅思题库。
