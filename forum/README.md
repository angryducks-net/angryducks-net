# AngryDucks 论坛 MVP0

规格见 `../docs/forum-mvp0-spec.md`。技术栈：Cloudflare Workers + D1，服务端直接输出 HTML，没有前端框架和构建步骤。

## 目录

| 路径 | 内容 |
|---|---|
| `src/index.js` | 路由和全部业务逻辑 |
| `src/views.js` | 页面模板和样式 |
| `src/util.js` | 纯函数：转义、tag 规范化、语言识别、热度公式、代码块识别、上传截断 |
| `src/markdown.js` | Markdown 渲染，禁止原始 HTML、代码块和图片 |
| `src/manifesto.generated.js` | 首页用的宣言文本，由脚本从根目录 `MANIFESTO.md` 生成，不要手改 |
| `scripts/sync-manifesto.mjs` | 把 `MANIFESTO.md` 同步到 README 和首页 |
| `src/auth.js` | 密码哈希（PBKDF2）、会话令牌 |
| `migrations/0001_init.sql` | 数据库表结构 |
| `test/unit.test.mjs` | 纯函数单元测试 |
| `test/smoke.mjs` | 端到端冒烟测试，需要一个空数据库加正在运行的本地服务 |

## 本地运行

```bash
npm install
npm run db:local
npm run dev
```

打开 http://localhost:8787/register ，邀请码填 `.dev.vars` 里的 `local-bootstrap`。第一个注册的账号自动成为管理员。

## 测试

```bash
npm run test:unit
```

冒烟测试需要空数据库，先用一个临时目录建库并启动服务：

```bash
npx wrangler d1 migrations apply angryducks-forum --local --persist-to /tmp/ad-smoke
npx wrangler dev --persist-to /tmp/ad-smoke
```

另开一个终端：

```bash
npm run test:smoke
```

每日上限测试也要空数据库，并用调低的上限启动服务：

```bash
npx wrangler d1 migrations apply angryducks-forum --local --persist-to /tmp/ad-limits
npx wrangler dev --persist-to /tmp/ad-limits --var DAILY_POST_LIMIT:2 --var RATE_LIMIT_PER_MIN:100
```

另开一个终端：

```bash
node test/limits.mjs
```

## 首页和宣言

同一个 Worker 按域名分流：`angryducks.net` 显示首页（论坛入口加宣言），其他域名都是论坛。

**宣言只改根目录的 `MANIFESTO.md` 一处。** 改完运行：

```bash
npm run sync
```

它会更新根目录 README 里的宣言段落和首页用的文本。`npm run deploy` 部署前也会自动跑一遍。忘了同步的话，`npm run test:unit` 会失败。

本地预览首页（把所有请求当作 angryducks.net）：

```bash
npx wrangler dev --local-upstream angryducks.net
```

## 第一次部署到 community.angryducks.net

前提：`angryducks.net` 已经在 Cloudflare 账号里，并且状态是 Active。如果域名是在 Cloudflare Registrar 买的，这一步已经满足。

1. 登录 Cloudflare，会打开浏览器授权：

```bash
npx wrangler login
```

2. 创建线上数据库，把输出里的 `database_id` 填到 `wrangler.toml` 替换全零占位符：

```bash
npx wrangler d1 create angryducks-forum
```

3. 建表：

```bash
npm run db:remote
```

4. 设置第一个管理员的引导码。命令会提示输入，填一个只有你知道的长随机串：

```bash
npx wrangler secret put BOOTSTRAP_CODE
```

5. 部署，同时绑定子域名：

```bash
npm run deploy
```

6. 打开 https://community.angryducks.net/register ，邀请码填第 4 步的引导码，注册后你就是管理员。之后这个引导码就失效了，因为它只对第一个账号有效。

7. 进 Admin 页面生成邀请码，发给种子用户。

## 日常运维

**更新代码**：

```bash
npm run deploy
```

**改表结构**：在 `migrations/` 新增 `0002_xxx.sql`，然后：

```bash
npm run db:remote
```

**每周备份**：

```bash
npx wrangler d1 export angryducks-forum --remote --output backup-$(date +%Y%m%d).sql
```

**用户忘记密码**：Admin 页面点 Reset password，把显示的临时密码私下发给对方。

## 已知限制

- 忘记密码只能找管理员，没有邮件。
- 全站登录后才能看。
- 不支持代码块和图片，正文最多 6000 字符；更长的文章请发到 Substack、博客或 GitHub 等处，再在帖子里放链接。
- 语言识别只按文字系统判断，拉丁字母的语言一律标为英文。
- 浏览器 Google 翻译对这种混合语言页面的实际效果还没在真机上验证。
