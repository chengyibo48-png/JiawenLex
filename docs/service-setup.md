# JiawenLex：把待完成服务配置好

更新：2026-09-29。正式网站 https://jiawen-lex.vercel.app 已可访问，用户已确认管理员登录成功；线上配置卡显示网站地址、SMTP 与 AI 密钥加密配置齐全。本机 Supabase 和 QQ SMTP 连接检查通过。独立 B2 加密备份已生成并通过本机解密与完整性复核；每日任务已启用，受保护接口检查通过。个人 DeepSeek 文本和百炼语音密钥已保存，用户报告连接检查通过；真实反馈、转写、邮件收件与完整隔离恢复演练仍待验收。

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

本项目的 **Production 网站根地址** 已确认为 `https://jiawen-lex.vercel.app`。Vercel 的 `NEXT_PUBLIC_SITE_URL` 使用该地址；如果在首次部署前已保存，等待该次部署成功即可，如果在部署后修改，则需 **Redeploy**。本机的 `NEXT_PUBLIC_SITE_URL` 保留 localhost，方便本机登录回跳。不要把 `HTTP_PROXY`、`HTTPS_PROXY` 的本机代理地址添加到 Vercel。

5. Supabase → Authentication → URL Configuration：**Site URL** 填线上根地址；**Redirect URLs** 保留 `http://localhost:3000`，并添加线上根地址。代码的验证与密码恢复回跳目前使用根地址，不需要凭空添加其他路径。
6. 打开线上地址，用已有管理员账号登录，再检查验证/密码恢复链接是否回到正确的网站。

Vercel 的 GitHub 集成会部署后续提交，操作依据 [官方导入说明](https://vercel.com/docs/git/vercel-for-github)。Hobby 的用途限制和大陆访问情况见 [计划说明](https://vercel.com/docs/plans/hobby)、[大陆访问说明](https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china)。

## 2. 配置个人 AI 服务

API Key 相当于服务调用凭证，**不是登录密码**。在 JiawenLex 的“设置 → AI 服务与预算”中填写，服务端会加密保存。每位成员使用自己的密钥和预算。个人服务商 API Key 无需添加到 Vercel 或 GitHub，已有 AI_KEY_ENCRYPTION_SECRET 保持不变。详细开通与错误处理见 [AI 配置逐步指南](ai-setup.md)。

### DeepSeek：用于文本反馈

1. 打开 [DeepSeek 开放平台](https://platform.deepseek.com/)，注册并登录。
2. 进入 **API Keys** 创建一个给 JiawenLex 使用的 key。是否需充值、充值金额由你在平台确认；本指南不承诺免费调用。
3. JiawenLex → 设置 → 文本反馈：服务商选 **DeepSeek**，把 key 填入 **API Key**，点“保存密钥”。
4. 点“检查连接”：仅查询模型信息和可用余额状态，不发送作文或录音、不请求文本生成。检查通过不代表实际生成权限或费用已验证。若提示余额不足，可暂时保持 AI 关闭。
5. 设置月度预算，例如先设 `10` 元，再打开 AI 开关，点“保存 AI 开关与预算”。这是应用内的费用估算阈值，最终费用以平台账单为准。
6. 用一篇短作文主动提交一次，确认数据发送提示、批注和费用记录。普通学习功能可一直关闭 AI。

当前调用 `deepseek-flash`，以非思考模式生成 JSON 反馈。参考 [接口说明](https://api-docs.deepseek.com/api/create-chat-completion/)、[当前价格](https://api-docs.deepseek.com/quick_start/pricing/)。

### 阿里云百炼：用于录音转写，也可用于文本反馈

1. 注册并登录 [阿里云百炼](https://bailian.console.aliyun.com/)。按照控制台要求开通服务；如提示实名认证，由你在该平台完成。
2. **当前 JiawenLex 接入的是“华北2（北京）”**。在控制台选择该地域，进入 API Key 页面创建 key，并选择所属业务空间。北京以外的 key 不要填入当前接入方式。
3. 在业务空间管理页面复制 **Workspace ID**。它是空间编号，不能用 APP ID、账号 ID 或 API Key 替代。
4. JiawenLex → 设置 → 录音转写：填写该 Workspace ID 和 API Key，点“保存密钥”。文本服务如改用 Qwen，也在“文本反馈”框内分别保存这两项。
5. 点“检查连接”，先确认密钥和模型信息可访问。使用按量付费 key；Coding Plan / Token Plan 专用密钥不适用于当前接入。模型信息检查不会发起转写，实际权限仍需提交后确认。
6. 录制一段约 10 秒的英语，选择是否保留录音，再确认发送进行转写。检查文字、反馈、预算提示以及默认不保存原音的行为。

步骤依据 [获取 key](https://help.aliyun.com/zh/model-studio/get-api-key/)、[获取 Workspace ID](https://help.aliyun.com/zh/model-studio/obtain-the-app-id-and-workspace-id)、[地域规则](https://help.aliyun.com/zh/model-studio/regions)。免费额度、模型权限和到期后的费用以你控制台显示为准。

## 3. 建独立私有备份存储

这是整个平台共用的系统备份，由网站维护者统一配置一次，普通成员不需要配置。备份包含全体成员的数据库记录和文件，存入维护者控制的独立私有存储，每周生成加密快照并保留最近四份。“独立”指存储服务与 Supabase 分开。备份凭据及解密密钥只交给维护者；持有解密密钥的人有恢复整个平台数据的能力。网站界面的管理员权限仍不提供读取其他成员私有记录的功能。个人 AI 密钥和预算则由每位成员分别配置。

本项目按“优先免费、达到限额就暂停”的要求，首选 **Backblaze B2 Cloud Storage 免费账号**。前 10 GB 存储免费；费用还可能来自下载等项目，因此不能只限制容量。使用单独的 B2 账号和私有 bucket，不绑定付款方式、不升级付费；进入 Caps & Alerts 核对账号的免费限制。依据 [当前价格](https://www.backblaze.com/cloud-storage/pricing)、[费用上限](https://www.backblaze.com/docs/cloud-storage-data-caps-and-alerts)。

### 第一步：创建免费账号并确认费用限制

1. 打开 [Backblaze B2](https://www.backblaze.com/cloud-storage)，选择 **Start Free**，注册并完成邮箱验证。选择 B2 Cloud Storage，不选 Computer Backup 或 B2 Overdrive。
2. 如果页面提示添加付款方式，选择跳过 / 免费试用选项；不要填写银行卡或开通付费订阅。若当前界面必须付款才能继续，停止并核对页面。
3. 左侧 B2 Cloud Storage → **Caps & Alerts** → **Edit Caps**。对可设置的存储、下载与请求类别取消 **No Cap**，尝试将付费上限设为 **0 美元 / 日**，保存。官方说明修改可能需要 10 分钟生效。若免费账号不能编辑，保留默认免费限制；若拒绝 0，不用最小付费金额替代，把不含密钥的限额区域截图交给维护者核对。
4. 在账号界面核对实际允许的免费用量，并确认未开通收费功能。Class D（例如事件通知）没有费用上限，不为本项目启用此类功能。网站不会自动提高供应商费用上限。

### 第二步：私有 bucket 和应用密钥

1. **Buckets → Create a Bucket**，名字可用 `jiawenlex-backups-chengyibo48`（名称须全局唯一），Files 选 **Private**。备份由程序保留最近四份，不为删除记录 `deletions/` 设置到期删除。
2. 在 bucket 页面复制 **S3 Endpoint**。它通常形如 `s3.us-west-004.backblazeb2.com`；配置时加上 `https://`，使用页面真实值。Region 对应 endpoint 中的地域编号，示例是 `us-west-004`。
3. **Application Keys → Add a New Application Key**，只授权刚建的 bucket，选 **Read and Write**，文件名前缀留空，以便访问同一 bucket 的 `snapshots/` 与 `deletions/`。不使用账号的 Master Key。记录生成的 **keyID** 与 **applicationKey**，后者只显示一次。
4. 在本机 `.env.local` 填五项：

| 变量 | 来源 |
| --- | --- |
| `BACKUP_S3_ENDPOINT` | 完整 HTTPS S3 Endpoint |
| `BACKUP_S3_REGION` | Endpoint 对应地域 |
| `BACKUP_S3_BUCKET` | 实际 bucket 名称 |
| `BACKUP_S3_ACCESS_KEY_ID` | keyID |
| `BACKUP_S3_SECRET_ACCESS_KEY` | applicationKey |

`BACKUP_ENCRYPTION_SECRET` 保留本机已有值，另存安全副本；丢失会无法解密备份。不要把任何密钥发到聊天中。

5. 将上述五项及 `BACKUP_ENCRYPTION_SECRET` 添加到 Vercel 的 **Production** 环境，再 Redeploy。密钥和解密密钥选 Secret；endpoint、region、bucket 可选 Config。后续 GitHub 备份使用同一组配置。

依据：[应用密钥](https://www.backblaze.com/docs/cloud-storage-create-and-manage-app-keys)、[设置限额](https://www.backblaze.com/docs/cloud-storage-create-and-manage-caps-and-alerts)。

### 应用容量保护

- 默认总容量上限：**8,000,000,000 字节（8 GB）**；可以用 `BACKUP_MAX_STORAGE_BYTES` 降低，代码拒绝设置得更高。
- 默认单次备份写入上限：**500,000,000 字节（500 MB）**；可以用 `BACKUP_MAX_SNAPSHOT_BYTES` 降低。这是写入量限制，不是供应商的下载费用限制。
- 计入加密开销、全部对象和 B2 历史版本。不能核实占用时暂停写入；容量不足时保留已有恢复点，不删除旧备份来强行挤出空间。只有新快照验证成功后，才按既有规则清理超出最近四份范围的旧快照及其全部版本。
- 失败时尝试清理本次产生的未验证快照；不清理其他快照或删除记录。GitHub 备份工作流串行执行。
- 应用预检查是额外保护，无法控制其他工具、同账号其他 bucket 的用量，也不能代替供应商的 0 元限制。并发写入有可能发生在同一次预检查之后；供应商限额是防止计费的最终控制。
- 在免费配置下，超过下载或请求限制可能导致校验 / 恢复暂停。保持 0 元限制，确认额度恢复后再重试；没有完成完整性校验的快照不标记成功。

2026-09-29 用户截图已确认 B2 账号创建完成：存储上限 $0 / 10 GB，下载上限 $0 / 每天 1 GB，Class B 与 C 各每天最多 2,500 次，邮件提醒已勾选。私有 bucket `jiawenlex-backups-chengyibo48` 已创建，Endpoint 为 `s3.us-west-004.backblazeb2.com`，加密已开启、Object Lock 已关闭、生命周期为保留全部版本。本机六项备份配置已填写。真实 B2 检查通过：HeadBucket、全部历史版本清单（当前 0 字节）、103 字节随机检查内容的加密上传、下载解密一致性检查，以及按版本删除；复查确认无检查文件残留。检查不包含数据库或学习内容。线上与 GitHub 工作流凭据、数据库连接、完整备份和恢复仍待完成。应用限制已加入代码，并通过本机 13 项模拟检查及 TypeScript 检查；含这些限制的 Vercel 部署已成功。


2026-09-29 用户报告已添加线上备份变量并重新部署。对应 Vercel 部署 `44dSp73tCwVpTHQrvJamydtDgdGu`（代码 `89c1499`）状态 success；正式首页 HTTP 200，未登录访问 `/api/admin/status` 返回 401。以上验证部署与登录保护，未读取线上密钥或确认后台六项配置；线上实际 B2 调用与完整备份仍待验收。下一步填写本机 `DATABASE_URL`，再配置 GitHub Actions secrets。

## 4. 启用每周备份与每日任务

2026-09-29 本机 `DATABASE_URL` 已填写并完成密码字符编码。使用隔离的临时 Psycopg 3.3.6 客户端，连接到用户指定的 Session pooler，SSL required 模式连接成功；只读事务状态 on，PostgreSQL 17.6，状态查询通过。未运行 pg_dump、完整备份或恢复。本机 pg_dump / pg_restore / psql 仍未安装；每周备份将使用工作流内的 PostgreSQL 17 客户端。用户报告 GitHub Actions 九项 Secrets 已添加；自动审批拒绝从本机 Git 登录机制获取凭据，相关操作未执行，也不通过其他来源重试。

首次备份运行 `36547086688` / job `109335976884`（main，89c1499）已在 GitHub 显示 success。日志确认快照 `snapshots/2026-09-29T09-09-14-819Z-fb2621e1/` 上传及内部完整性校验通过，附件 0 个。B2 只读清单确认 database.jlex 500,784 字节、manifest.jlex 265 字节、verified.jlex 148 字节。但用本机当前 BACKUP_ENCRYPTION_SECRET 解密清单失败（AES-GCM authentication failure）；启动环境与本机文件值一致，且已排除该备份密钥带空格、换行、引号、整行变量名等常见复制格式差异。因此首次完整备份尚未通过独立恢复准备验收，需要用户将 GitHub 同名 Secret 重新填为本机现有值，再重跑并复核；Vercel 的同名配置也须使用相同值。当前快照未修改或删除，不尝试其他服务凭据，不执行真实恢复。

2026-09-29 用户重新填写 GitHub 的 BACKUP_ENCRYPTION_SECRET 后，通过已连接的 GitHub 应用重跑同一运行（36547086688，第二次 job 109342468418），全部步骤 success。新快照 snapshots/2026-09-29T09-27-07-915Z-1c196ace/ 已通过本机独立只读复核：使用本机现有密钥成功解密 manifest、verified 标记和数据库；清单结构、标记指纹、数据库字节长度与 SHA-256 均一致，数据库头为 PostgreSQL custom archive（PGDMP）。数据库明文长度 500,751 字节，附件 0 个；此次下载共 501,197 字节，明文仅在内存中使用。B2 全部历史版本总占用 1,002,394 字节，低于应用 8,000,000,000 字节上限。第一次无法用本机密钥解密的旧快照仍保留，未修改；不能将它计为已通过独立复核的恢复点。每周工作流的既有计划为星期日 02:00 UTC（北京时间星期日 10:00）。Vercel 的同名密钥是否一致尚未独立确认；完整隔离恢复演练、真实附件恢复和删除记录重放验收仍待执行，以上完整性复核不能代替这些验收。

### 每周备份：在 GitHub 执行

1. Supabase 项目点击 **Connect**，选择 **Session pooler** 连接（非 Transaction pooler）。将完整连接串填入本机 `DATABASE_URL`，其中 PASSWORD 是 **数据库密码**，不是邮箱密码或 API Key；特殊字符需按连接串要求编码。
2. GitHub 仓库 → **Settings → Secrets and variables → Actions → New repository secret**，逐个填写：`DATABASE_URL`、`NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SECRET_KEY` 和六个 `BACKUP_*` 变量。数据库连接仅给备份工作机使用，无需放进浏览器或 Vercel。
3. GitHub → **Actions → Encrypted weekly backup → Run workflow**，观察是否成功。流程使用 PostgreSQL 17 客户端，备份后自动下载、解密并校验；校验成功后才保留最近四份已验证快照。
4. 保存第一次成功的时间与快照前缀，安排下面的真实恢复演练。GitHub 的定时任务可能延迟，应定期查看实际运行记录。

### 每日提醒与一年清理：在 Supabase 调度

2026-09-29 用户确认 Vercel 的 BACKUP_ENCRYPTION_SECRET 已同步本机值并重新部署。GitHub 中对应部署 AtUkmvSvJpFygrizHEfyuVTjKt1t（89c1499）状态 success；正式首页 HTTP 200，未登录管理员接口 HTTP 401。没有读取线上备份密钥，密钥一致性依据用户配置确认。启用 pg_cron 1.6.4、pg_net 0.20.4，使用参数化数据库客户端将现有本机 CRON_SECRET 与线上根地址保存到 Vault；本机值一致性复核通过，未输出密钥。按仓库 supabase/cron.sql 建立两个任务：jiawenlex-reminders 每 15 分钟运行，jiawenlex-retention 每日 03:15 GMT（北京时间 11:15）运行，均 active。Vault 解密视图对 anon/authenticated 不可读；cron.job 已启用 RLS，既有策略限制 username=CURRENT_USER，两个任务由 postgres 所有。当前 1 个活动成员，提醒开启人数 0，所有清理条件对应记录数 0。分别通过本机及数据库 pg_net 发起受保护接口检查；Supabase 请求 1/2 均 HTTP 200、无超时、无错误，reminders 返回 sent=0/failed=0，retention 返回 purged=0/draftsPurged=0/sessionsPurged=0。此验证不包含真实邮件发送、过期数据删除、附件恢复或删除记录重放；成员提醒偏好保持关闭。

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
| 个人 AI 文本／转写实际调用 | 已保存 DeepSeek 文本与百炼语音；连接检查由用户确认；Qwen 文本仍需单独保存，实际调用记录为零 |
| 正式网站与管理员登录 | 已部署；公开页面检查通过，用户确认登录成功 |
| 邮件收件与登录回跳 | SMTP 连接通过；真实邮件流程待验收 |
| 提醒与一年清理调度 | 提醒每十五分钟，清理已改为每六小时；均启用。原接口连接通过；真实邮件、清理与恢复仍待验收 |
| 独立加密备份、真实恢复演练 | 第二次备份 success，本机解密及完整性复核通过；用户确认 Vercel 密钥同步并重新部署；完整隔离恢复仍待验收 |

最新核对与本轮修复见 [v1 实施核对](v1-implementation-audit-2026-09-29.md)。上面的部署／备份运行记录保留各次检查当时的状态。
