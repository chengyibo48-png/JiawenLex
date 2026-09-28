# JiawenLex

邀请制雅思备考工作台。首期支持 Academic 四科练习、词汇、计划、资料库、进度、草稿和可选的 AI 反馈；GT 用户可使用通用功能。资料库初始为空，不包含官方题库。`NEXT_PUBLIC_DEMO_MODE=true` 只用于本机体验，内有明确标注的自创示例。

## 本机启动

需要 Node.js 22、pnpm 11。运行 `pnpm install`，复制 `.env.example` 为 `.env.local`。若仅看演示，把 `NEXT_PUBLIC_DEMO_MODE=true` 留着，执行 `pnpm dev` 并打开 `http://localhost:3000`。演示数据存在当前浏览器，不连接 Supabase，也不模拟真实邮件、AI 或备份。

## 建立正式环境

1. 在 Supabase 新加坡区域建项目，在 SQL Editor 完整执行 `supabase/migrations/202609280001_initial.sql`。此 SQL 建立表、行级访问策略、私有 Storage bucket 和邀请码检查函数。
2. 在 `invite_control` 插入首个邀请码的 SHA-256。示例 SQL：`insert into public.invite_control(id, code_hash) values (1, encode(digest('请换成长随机邀请码', 'sha256'), 'hex'));`。请自行生成至少 12 字符的随机码，仅私下保存明文。第一位用该码注册的用户自动成为管理员，其预设目标为 7.5 / 2027-02-28 / 每周 10 小时；首次登录仍会显示目标设置。后续成员默认不带分数和日期。
3. 在 Supabase Auth 启用 **Confirm email**、配置邮件链接 Redirect URL，然后在 Auth Hooks 中启用 **Before User Created**，指向数据库函数 `public.jiawenlex_before_user_created`。务必先启用 Hook，再开放网站，否则 Auth API 可绕过页面的邀请码输入。不要开放匿名注册流程。
4. 打开项目 **Settings → API Keys**，将 Publishable key 填入 `.env.local` 的 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`，将 Secret key 填入 `SUPABASE_SECRET_KEY`；项目 URL 填入 `NEXT_PUBLIC_SUPABASE_URL`。代码也兼容旧项目的 `SUPABASE_SERVICE_ROLE_KEY`。Secret key 仅用于服务端。为 Supabase Auth 配置外部 SMTP；同一 SMTP 可供每日提醒使用，并填写 `.env.local` 中的 SMTP 参数。填好密钥并执行迁移、设置注册 Hook 后，将 `NEXT_PUBLIC_DEMO_MODE=false`，重启开发服务器进入真实登录流程。
5. 配置独立的私有 S3 兼容存储和 `BACKUP_ENCRYPTION_SECRET`，并为部署环境填写相同变量。注销、删除、撤销分享以及一年清理在写入外部加密删除记录失败时会停止，避免恢复旧备份后复现已删数据。备份桶不能公开访问，也不能与 Supabase Storage 混用。
6. 生成长度至少 32 字符的独立 `AI_KEY_ENCRYPTION_SECRET`、`FILE_ACCESS_SECRET` 和 `CRON_SECRET`。用户的 AI 密钥在服务端以 AES-256-GCM 加密保存，浏览器只能读取服务商名称与是否已配置。
7. 在 Vercel 创建 Next.js 项目并填写环境变量，部署前确保 `NEXT_PUBLIC_DEMO_MODE=false`。免费试用地址可能在中国大陆访问不稳定；本项目没有为大陆访问作保证。Vercel Hobby 仅适用非商业个人用途。
8. 在 Supabase Vault 中保存 `jiawenlex_site_url`（正式网站根 URL）和 `jiawenlex_cron_secret`（与环境变量 `CRON_SECRET` 相同），启用 `pg_cron` 与 `pg_net`，再执行 `supabase/cron.sql`。提醒任务每 15 分钟检查时区与用户设定时间，且同一当地日期只发一次；清理任务每日处理一批超过一年的原始内容。邮件提醒默认关闭。
9. 将仓库放入 GitHub 后，在 Actions Secrets 中配置 `.github/workflows/backup.yml` 使用的数据库与备份变量。工作流每周生成数据库和文件的 AES-256-GCM 加密快照，并立即校验新快照；只保留最近 4 份完整快照。另需每月在独立恢复环境执行下面的恢复演练。

首次正式上线前，管理员应检查所有共享资料的来源与使用许可。普通成员不能审批自己的共享资料；管理员界面只读取待审核共享资料与成员名，不展示他人私有练习或 AI 密钥。

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
