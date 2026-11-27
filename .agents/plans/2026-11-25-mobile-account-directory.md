# Mauwork 手机端方案：账号目录 + 独立中继（v2 规格）

> 状态：待评审，未开发。
> v2 变更：**中继服务器与账号后端拆成两台独立机器**（原 v1 为同机部署）。中继不再和账号数据同机，只做字节转发，不知道账号是谁。
> v2.1 变更：D5 改为**同账号直接放行**（每台电脑保留开关）；手机登录复用桌面同一套 `/auth/*` 接口，新增 §8.8 认证复用与四项核对。
> 用途：可直接交给 AI 开发者按此实现。接口、字段、状态机、验收项都是可执行规格；上游未知细节列在附录 A，开发前必须先定位回填。
> 位置说明：本文件是工作规格，不是 Agent Note，不进 `.agents/notes/`。实现落地后可删除。

---

## 一、目标（用户视角）

1. 电脑上登录 Mauwork 账号（现有 mio 登录）。
2. 手机安装 Mauwork App，同一账号登录（短信验证码或密码）。
3. 手机看到「我的电脑」：哪几台在线、离线、最后在线时间。
4. 点一台电脑 → 首次需在电脑上点「允许」→ 手机进入这台电脑的会话列表。
5. 手机上继续同一个任务：发消息、看工具输出、审批。
6. 电脑换网络、换地址，手机自动重配，不用重扫。
7. 二维码扫码保留为兜底（未登录、访客、临时连接）。

**原则：账号只负责「认人、给清单、发票、发中继租约」；中继只负责转发字节；内容不落地、不经过账号后端。**

## 二、不做什么（v1 明确排除）

- 不做云端会话存储、云端历史、跨设备同步聊天记录。
- 不做账号侧的「手机管理」（手机吊销仍由电脑端管理）。
- 不做团队共享、多用户共用电脑、电脑互连。
- 不做电脑离线时查看会话。
- 不把模型 key 或账号长期 token 下发到手机。
- v1 不做多中继容灾（单中继 + 快速重启 + 监控；见 §16）。

## 三、已核实的现状（开发前先读，避免重复推导）

| 事实 | 位置 |
|---|---|
| 账号服务定义 `MioAccount`，HTTP 实现 `MioAccountHttp` | `packages/credentials/mio-account/src/service.ts`、`src/index.ts` |
| 业务后端前缀 `/mio/client/v1`，鉴权头 `Authorization: Bearer <accessToken>` | `src/client.ts:12,82` |
| 登录路径：`/auth/sms/code`、`/auth/register`、`/auth/login/password`、`/auth/login/sms`、`/auth/password/reset`、`/auth/logout`、`/users/me` | `src/index.ts:129-354` |
| 账号 token 存凭据 seam 的 `mio-account/session`；无 Remote 方法返回 token | `src/index.ts`（`SESSION_KEY`） |
| 后端地址由配置 `businessBaseUrl` 决定（默认 `http://localhost:8080`），客户端自拼 `/mio/client/v1` | 同上 `Config` |
| 401 删除本地会话并发 `mio-account/session-expired`；过期只靠后端判断 | 同上 README |
| Host HTTP 服务暴露实际绑定 `ctx.webServer.port` / `ctx.webServer.host` | `packages/host/webserver/src/index.ts:406,411` |
| 桌面窗口加载 HTTP Origin | `apps/desktop/src/main.ts:504` |
| 插件规范：Cordis effect、`@Remote`+Typert、`HarnessError`、客户端文案走 locale、新文件 LF | `AGENTS.md`、`packages/AGENTS.md` |

**saya-ch/dsh-mobile 已核实行为（内部代码需定位）：**

- Host face：发现、配对、HTTPS、回环代理、扩展注册表；局域网默认 3443，上游默认 3080。
- 手机拿到同一份 DSH Web 页面（Android 为 Kotlin WebView 薄壳）。
- 配对码短期有效；二维码不含长期 token 与 CA 私钥。
- 设备 token 只发往精确 Origin，存 Android Keystore；电脑端存 token 摘要 + 随机设备标识。
- 电脑端「设备」页可查看/吊销；吊销 = 永久删除记录，旧 token 返回 `401 authentication_failed`。
- 同 Origin 自动续期；**地址 / 证书 / 端口变化后必须重新配对**。
- 隧道：cloudflared（quick/named）、Tailscale Funnel、cpolar、自建 FRP、自有反代、托管 Caddy、iroh（实验）。
- `extensions/host.mjs` 以本机用户权限运行 = 电脑本机 RCE；`/mobile` 会让本机 agent 改 `$DSH_HOME/mobile-access/`。
- 状态目录：`$DSH_HOME/mobile-access/`。
- 公开通道目前用系统信任证书；局域网用私有 CA 固定。

## 四、总体架构（后端与中继分离）

```
┌────────────┐  ①登录 / 设备清单 / 领配对票 / 领租约   ┌─────────────────────────┐
│  手机 App   │ ─────────────────────────────────────▶ │ 账号后端 API（阿里云 A）  │
└─────┬──────┘ ◀───────────────────────────────────── │ 数据库只存设备元数据      │
      │                                                 └───────────▲─────────────┘
      │ ③访问 https://dev-abc.relay.example.com                      │ ②心跳 + 领/续中继租约
      │   TLS 端到端到电脑，中继不解密                                │   （30 秒一次）
      ▼                                                              │
┌──────────────────────────────┐                ┌────────────────────┴─────────┐
│ 中继服务器（阿里云 B，独立机） │ ◀── ④电脑主动连出 ── │ 用户电脑：Mauwork + 插件      │
│ - 按 SNI 分流，只转发密文      │     （长连接保持）    │ 会话、工具、审批都在本机      │
│ - 无数据库、无账号数据         │                      │ frpc + 账号目录模块          │
│ - 按设备租约鉴权               │                      │                              │
└──────────────────────────────┘                      └──────────────────────────────┘
```

**四者关系：**

| 关系 | 内容 | 走哪 | 谁会看到内容 |
|---|---|---|---|
| ① 手机 ↔ 后端 | 登录、清单、配对票、设备指纹 | HTTPS | 后端只看到元数据 |
| ② 电脑 ↔ 后端 | 登记、30 秒心跳、领中继租约 | HTTPS（出站） | 后端只看到元数据 |
| ③ 手机 ↔ 中继 | 访问 `dev-xxx.relay.…` | HTTPS/WebSocket | **中继只看到密文** |
| ④ 电脑 ↔ 中继 | 开机保持的长连接 | 出站长连接 | 中继只看到连接元数据 |

**拆分带来的四个收益：**

1. **爆炸半径隔离**：中继是公网最暴露的组件，被攻破也拿不到账号库、设备清单、任何用户身份数据。
2. **独立扩容**：中继按带宽扩容，后端按请求量扩容，互不牵连。
3. **故障隔离**：中继重启只断实时连接，登录和清单不受影响；后端重启不影响已建立的实时连接。
4. **合规简单**：中继不需要 PII，日志只留连接元数据；账号数据只在一台机器上。

**数据边界：**

- 后端存：设备 ID、名称、平台、地址列表、TLS 指纹、最后心跳、在线状态、客户端版本、子域名。
- 后端不存：聊天内容、会话 ID、消息、工具输出、模型 key、密码。
- 中继存：仅内存中的连接表（子域名 → 连接）。不落盘、不记内容。
- 手机存：账号 token（目录接口用）+ 每台电脑各自的设备 token + 每台电脑的 TLS 指纹。

## 五、六条不变量（违反任何一条都算实现错误）

1. **内容不过账号后端。** 后端任何接口、日志、表字段都不得含会话内容或模型凭据。
2. **中继不解密。** 中继按 SNI 分流并转发原始 TLS 字节；它没有电脑私钥、没有会话内容、没有账号 token。
3. **票只能换一次。** 后端签名、120 秒有效、绑定「电脑 + 手机公钥」；电脑本地一次性校验。
4. **新手机默认要人确认。** 首次见到的手机公钥必须在电脑上点「允许」；同一公钥再次配对（地址变化）自动放行。
5. **手机拿不到模型 key。** 手机只拿「某台电脑的设备 token」。
6. **账号退出 ≠ 断开已配对手机。** 退出只让电脑从账号清单消失；本机配对继续可用，必须显式吊销。

## 六、关键决策（评审请拍板，括号内为推荐默认）

| # | 决策 | 选项 | 推荐 |
|---|---|---|---|
| D1 | 公网通道 | Cloudflare 隧道 / 自建中继 | **自建中继**（独立机，见 §9） |
| D2 | 二维码是否保留 | 保留 / 移除 | **保留**（兜底） |
| D3 | 手机登录方式 | 短信+密码 / 只短信 | **两者都留** |
| D4 | 插件分发 | 内置进桌面 / 走插件市场 | **内置**，市场做升级 |
| D5 | 首次配对确认 | 电脑弹窗 / 同账号直接放行 | **同账号直接放行**（每台电脑保留 `requireApproval` 开关，默认关；放行时桌面弹通知，可一键断开） |
| D6 | 账号侧手机管理 | v1 不做 / 做 | **v1 不做** |
| D7 | 中继 TLS 模式 | 端到端透传 / 中继解密 | **端到端透传**（中继看不到内容） |
| D8 | 中继实现 | FRP + 本地鉴权插件 / 自研最小中继 | **FRP + 本地鉴权插件**（SNI 透传已实测通过，见 §9.3；自研备选关闭） |
| D9 | 域名与备案 | 大陆（备案） / 香港（免备案） | **内部测试香港；正式版大陆+备案** |
| D10 | 子域名规则 | 随机短 ID / 用户可读名 | **随机短 ID**（`dev-` + 8–10 位），不暴露手机号/姓名 |
| D11 | 手机账号 token 范围 | 复用桌面同款 / 后端加 mobile scope | **先复用**；M0 确认后端能否加 scope，能加就只授 `/mobile/*` + `/users/me` + `/auth/logout` |

## 七、核心流程

### 7.1 首次连接

```
手机登录账号
  → GET  /mobile/devices                    拿到电脑清单（在线状态、地址、中继子域名、TLS 指纹）
  → 点一台在线电脑
  → 手机生成/读取本机密钥对（Android Keystore）
  → POST /mobile/pair-tickets               后端签一张配对票（120 秒、一次性）
  → 连接 https://<子域名>.relay.…           中继按 SNI 转到电脑；手机校验 TLS 指纹
  → POST /mobile-access/directory/redeem    电脑验票
      ├─ 已认识这台手机的公钥 → 直接发 token → 200
      ├─ requireApproval=false（默认，同账号放行）→ 直接发 token → 200
      │    电脑弹通知「新设备已连接」，可一键断开
      └─ requireApproval=true → 202 + approvalId
           → 电脑弹「允许 / 拒绝」（60 秒，默认拒绝）
           → 手机每 2 秒轮询 approval-status
           → 允许 → 拿到 token → 进入会话列表
```

### 7.2 电脑上线与中继租约

```
电脑启动 → 读本机 deviceId / 中继密钥对
  → POST /mobile/devices/register（带地址列表、TLS 指纹）
  → 后端返回：子域名 + 中继地址 + 租约（JWT，10 分钟）
  → 电脑用租约连中继（frpc），中继本地验签
  → 每 30 秒心跳，后端续发新租约；租约到期前必须完成下次心跳
  → 心跳失败：退避重试（30/60/120/300 秒）；旧租约到期后中继断开该设备
```

### 7.3 地址变化（换网络、换隧道）

```
手机打开某台电脑
  → 用本地缓存的 token + 指纹连接
  → 401 / 连不上 / 指纹变化
  → 重新 GET /mobile/devices 拿最新地址、子域名、指纹
  → POST /mobile/pair-tickets 重新领票
  → redeem：电脑发现公钥已批准 → 自动放行，无需再点允许
  → 更新本地 token 与指纹，继续使用
```

> 这是账号方案相对纯扫码的最大体验收益：**地址变了自动重配。**

### 7.4 吊销与移除

- 电脑端删除某台手机 → 本机记录删除 → 手机下次请求 `401` → 手机清 token。
- 手机仍在账号里看到这台电脑，可重新领票，但会再次触发「允许」。
- 电脑从账号移除：电脑端调 `DELETE /mobile/devices/{deviceId}`；心跳返回 `known:false`；电脑停止中继连接（中继最迟 10 分钟后因租约过期断开）；页面显示「已从账号移除 [重新添加]」。
- 已配对手机不受影响（不变量 6）。

---

## 八、账号后端改动（阿里云 A）

> 后端代码不在本仓库。以下是可直接实现的契约；响应包络、错误码风格、鉴权中间件**复用现有业务接口**（参考 `packages/credentials/mio-account/src/wire.ts` 与 `/auth/*`、`/users/me` 现有实现），不要自创第二种包络。

### 8.1 通用约定

- 前缀：`{businessBaseUrl}/mio/client/v1`，新增命名空间 `/mobile/*`、`/relay-key`。
- 鉴权：`Authorization: Bearer <accessToken>`；`GET /mobile/pair-key`、`GET /mobile/relay-key` 免鉴权。
- 时间一律毫秒时间戳；所有响应带 `serverTime`，客户端据此校正时钟。
- 幂等：`register`、`heartbeat` 幂等；`pair-tickets` 不幂等但受限流约束。
- 用户隔离：查询强制带 `user_id`；跨账号一律 `404`。
- 日志：只记 `userId`、`deviceId`、`ticketId`、结果码；**禁止**记录 token、票原文、聊天内容。

### 8.2 数据表

`mobile_host_device`（电脑）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | bigint PK | 自增 |
| `user_id` | bigint | 账号 |
| `device_id` | varchar(64) | 电脑本地生成的 UUID，`(user_id, device_id)` 唯一 |
| `name` | varchar(128) | 电脑名，用户可改 |
| `platform` | varchar(16) | `win32` / `darwin` / `linux` |
| `client_version` | varchar(32) | 桌面版本 |
| `origins` | json | `[{"url","kind":"lan"|"public","stable":bool}]`，最多 8 条 |
| `tls_fingerprint` | varchar(128) | 电脑对外 TLS 证书的 SHA-256（手机据此固定） |
| `relay_subdomain` | varchar(64) | 分配的子域名前缀，如 `dev-a1b2c3d4`，唯一 |
| `relay_public_key` | varchar(512) | 电脑的中继密钥公钥（base64url SPKI，用于连接挑战） |
| `last_seen_at` | bigint | 最后心跳；`online = now - last_seen_at < 90_000` |
| `created_at` / `updated_at` | bigint | |

索引：`(user_id, last_seen_at)`、`(user_id, device_id)` 唯一、`relay_subdomain` 唯一。

`mobile_pair_ticket`（配对票，用于限流与审计；一次性在电脑端强制）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | bigint PK | |
| `ticket_id` | varchar(64) | JWS 的 `tid`，唯一 |
| `user_id` | bigint | |
| `host_device_id` | varchar(64) | 目标电脑 |
| `phone_device_id` | varchar(64) | 手机 UUID |
| `phone_public_key` | varchar(512) | base64url(SPKI P-256) |
| `expires_at` | bigint | 120 秒 |
| `created_at` | bigint | |

索引：`(user_id, host_device_id, created_at)`；定时删除 1 天前记录。不软删；`DELETE` 直接删设备行。

**子域名规则**：`dev-` + `base32(sha256(deviceId + 固定盐))` 前 8 位，小写、去掉易混字符；冲突则取前 10 位。确定性生成，设备重装/重注册不变；不含姓名、手机号、邮箱。

### 8.3 接口

#### ① `POST /mobile/devices/register`

请求：
```json
{
  "deviceId": "0b0d…uuid",
  "name": "张三的 MacBook",
  "platform": "darwin",
  "clientVersion": "0.1.9",
  "app": "mauwork-desktop",
  "origins": [
    { "url": "https://192.168.1.23:3443", "kind": "lan", "stable": false },
    { "url": "https://dev-a1b2c3d4.relay.mauwork.com", "kind": "public", "stable": true }
  ],
  "tlsFingerprint": "sha256:AB:CD:…",
  "relayPublicKey": "base64url(SPKI Ed25519)"
}
```
响应：
```json
{
  "deviceId": "…",
  "serverTime": 1763000000000,
  "relay": {
    "subdomain": "dev-a1b2c3d4",
    "publicUrl": "https://dev-a1b2c3d4.relay.mauwork.com",
    "endpoint": "relay.mauwork.com:7000",
    "lease": "<JWS>",
    "leaseExpiresAt": 1763000600000
  }
}
```
行为：按 `(user_id, device_id)` upsert；`name` 也在这里更新。

#### ② `POST /mobile/devices/heartbeat`

请求：
```json
{
  "deviceId": "…",
  "origins": [ … ],
  "clientVersion": "0.1.9",
  "tlsFingerprint": "sha256:AB:CD:…"
}
```
响应：
```json
{
  "known": true,
  "serverTime": 1763000000000,
  "account": "active",
  "relay": { "subdomain": "…", "publicUrl": "…", "endpoint": "…", "lease": "<JWS>", "leaseExpiresAt": … },
  "pendingActions": []
}
```
- `known:false` → 电脑停止中继连接并停止上报。
- `account:"denied"` → 停止上报并提示。
- 租约每次心跳续发；电脑必须用最新租约重连或续期。

#### ③ `GET /mobile/devices`

```json
{
  "serverTime": …,
  "devices": [
    {
      "deviceId": "…", "name": "张三的 MacBook", "platform": "darwin",
      "online": true, "lastSeenAt": 1762999990000, "clientVersion": "0.1.9",
      "tlsFingerprint": "sha256:AB:CD:…",
      "relay": { "publicUrl": "https://dev-a1b2c3d4.relay.mauwork.com", "subdomain": "dev-a1b2c3d4" },
      "origins": [
        { "url": "https://192.168.1.23:3443", "kind": "lan", "stable": false },
        { "url": "https://dev-a1b2c3d4.relay.mauwork.com", "kind": "public", "stable": true }
      ]
    }
  ]
}
```
按 `online` 降序、`lastSeenAt` 降序；不返回任何密钥或内部地址。

#### ④ `DELETE /mobile/devices/{deviceId}`

`204`。删除设备行与未过期票；不存在或不属于当前用户 → `404`。

#### ⑤ `POST /mobile/pair-tickets`

请求：
```json
{ "hostDeviceId": "…", "phoneDeviceId": "…", "phoneName": "Pixel 9", "phonePlatform": "android", "phonePublicKey": "base64url(SPKI P-256)" }
```
响应：`{ "ticket": "<JWS>", "expiresAt": …, "serverTime": … }`

拒绝：不存在/非本人 → `404 dev/not-found`；离线 → `409 dev/offline`；超限 → `429 dev/rate-limited`；公钥非法 → `400 dev/invalid-public-key`。

#### ⑥ `GET /mobile/pair-key`（免鉴权）

```json
{ "keys": [ { "kid": "k1", "alg": "EdDSA", "publicKey": "base64url(SPKI)" } ] }
```
`Cache-Control: public, max-age=86400`；轮换保留新旧至少 30 天。

#### ⑦ `GET /mobile/relay-key`（免鉴权，给中继取验签公钥）

```json
{ "keys": [ { "kid": "r1", "alg": "EdDSA", "publicKey": "base64url(SPKI)" } ] }
```
同样缓存与轮换策略；中继启动时拉取、每 24 小时刷新、遇未知 `kid` 立即刷新。

### 8.4 配对票格式

JWS Compact，`alg=EdDSA`（Ed25519），header `{ "alg":"EdDSA", "kid":"k1", "typ":"JWT" }`，payload：
```json
{ "v": 1, "tid": "随机 128-bit", "uid": 123, "hid": "目标电脑 deviceId",
  "pid": "手机 deviceId", "pk": "手机公钥", "iat": 1763000000, "exp": 1763000120 }
```
电脑端校验顺序（任一失败统一拒绝，不向手机泄露原因）：
1. header `alg/kid` 已知。
2. 签名有效。
3. `v === 1`。
4. `exp > now` 且 `iat <= now + 120s`。
5. `hid === 本机 deviceId`。
6. `uid === 本机当前登录 userId`。
7. 请求体 `phoneDeviceId`、`phonePublicKey` 与票内 `pid`、`pk` 一致。

### 8.5 中继租约格式

JWS Compact，`alg=EdDSA`，header `{ "alg":"EdDSA", "kid":"r1", "typ":"relay-lease" }`，payload：
```json
{ "v": 1, "did": "电脑 deviceId", "sub": "dev-a1b2c3d4",
  "pk": "电脑中继公钥", "exp": 1763000600, "iat": 1763000000 }
```
- 有效期 10 分钟；每次心跳续发。
- 中继本地验签，不回调后端（保持故障隔离）。
- 浏览器/手机不接触租约，租约只给电脑。

### 8.6 错误码

| HTTP | code | 场景 |
|---|---|---|
| 400 | `dev/invalid-request` | 字段缺失/格式错误 |
| 400 | `dev/invalid-public-key` | 公钥格式错误 |
| 401 | （现有鉴权错误） | token 失效 |
| 403 | `dev/account-inactive` | 账号不可用 |
| 404 | `dev/not-found` | 设备不存在或不属于当前用户 |
| 409 | `dev/offline` | 电脑不在线 |
| 409 | `dev/duplicate-device` | 同 deviceId 平台不一致 |
| 429 | `dev/rate-limited` | 限流 |
| 500 | `dev/internal` | 未预期错误（带 trace id） |

### 8.7 限流与运维

- `pair-tickets`：每用户每分钟 10 次、每电脑每分钟 5 次。
- `register`：每设备每分钟 10 次；`heartbeat`：每设备每分钟 4 次。
- 清理：删 1 天前的票；设备不自动删（离线也要可见）。
- 监控：注册数、心跳成功率、票签发数、按错误码分类失败数。
- 私钥放 KMS/环境变量；轮换见 8.3⑥⑦。

### 8.8 手机端复用桌面登录接口

**复用同一套**：`/auth/sms/code`、`/auth/login/sms`、`/auth/login/password`、`/auth/register`、`/auth/password/reset`、`/auth/logout`、`/users/me`。请求包络、错误码、协议文案不变；手机请求头带 `x-client: mauwork-mobile` 与 `x-device-id`，便于审计、限流和风控。

**M0 必须与后端确认四件事：**

1. ~~**登录复用**~~：**已确认（2026-11-26）**——手机复用桌面同一套 `/auth/*` 接口，账号后端不需要为手机新增登录接口。
2. **多端并存**：同一账号允许多个 token 同时有效。桌面已登录时，手机登录不能把桌面踢下线。
3. **单 token 登出**：`/auth/logout` 只撤销当前 token。若后端只能全局撤销，手机端**不得调用** `/auth/logout`，只清本地 token（设置页文案相应调整）。
4. **token 作用域**：能否给手机发受限 token，只允许 `/mobile/*`、`/users/me`、`/auth/logout`。能加则加（D11）；不能加则 v1 复用同款 token，并在风险表记录。
5. **短信风控**：验证码按手机号与 IP 的限流阈值；手机端上线会增加短信量，需要防止被刷。

**开发期替身**：假后端已落地 `E:\work\code\mauwork\fake-backend\server.mjs`（契约 §8 全量、EdDSA 验签真实、固定验证码 `123456`），`smoke.mjs` 14 项核对全过；在第 2–5 条确认前，桌面插件与 Android 都按「多 token 并存 + 单 token 登出」的默认语义联调。

**另外**：现有文档说明密码重置会让后端撤销账号 token；手机端完成密码重置后，要提示「电脑端会退出登录，需要重新登录」。

---

## 九、中继服务器（阿里云 B，独立服务）

### 9.1 职责与非职责

**只做四件事：**

1. 接受电脑主动连入的长连接，用后端签发的租约鉴权。
2. 在 443 上按 TLS SNI（域名）把手机请求分流到对应电脑的连接。
3. 双向转发原始字节，带背压、超时、连接数上限、字节限速。
4. 输出连接级指标与元数据日志（不含内容）。

**绝不做：**

- 不终止 TLS、不解密、不解析 HTTP、不存内容。
- 不存账号数据、设备清单、手机身份；没有数据库。
- 不主动连后端（只在启动/定时拉取验签公钥）。
- 不做业务判断（允许/拒绝配对是电脑的事，中继只认租约）。

### 9.2 部署与网络

| 项 | 要求 |
|---|---|
| 机器 | 阿里云轻量/ECS，2 核 4G 起，固定公网 IP，位置按 D9 |
| 带宽 | 起步 10 Mbps 或按流量计费；按 §9.9 评估 |
| DNS | `*.relay.mauwork.com` → 中继公网 IP（一条通配符 A 记录） |
| 端口 | 443 对外；电脑接入端口（如 7000）对外；管理/指标端口只对 VPC 或白名单开放 |
| 安全组 | 只放 443、7000、运维白名单；禁止数据库/Redis 等任何内部端口 |
| 系统 | 最小安装；自动安全更新；专用非 root 用户；systemd 托管 |
| 磁盘 | 不需要数据盘；日志滚动保留 7 天 |
| 证书 | 数据面**不需要**证书（透传）；仅管理端点用一张普通证书 |

**TLS 端到端的关键点：**

- 电脑使用自己的自签证书（复用现有每装机私有 CA 的能力）。
- 手机在配对时从后端拿到该电脑的 `tlsFingerprint`，连接时校验；不匹配即失败。
- 因此中继无需持有 `*.relay` 通配符证书的私钥，也不承担证书签发；通配符私钥只存在于证书系统（或根本不需要）。

### 9.3 数据通路

```
手机 TLS ClientHello(SNI=dev-a1b2.relay…)
  → 中继读 SNI，查连接表
  → 找到该子域名对应的电脑长连接
  → 原样转发字节（不解密）
  → 电脑本地完成 TLS 握手（自签证书）
  → 手机校验指纹 → 建立 HTTP/WebSocket
```

- 中继能看到：源 IP、SNI 域名、字节数、连接时长、租约里的 deviceId。
- 中继看不到：请求内容、会话、token（设备 token 在 TLS 内）、模型 key。
- 长连接复用：一条电脑连接可承载多个手机连接；按子域名做连接组。

### 9.4 电脑接入鉴权

1. 电脑从 register/heartbeat 响应拿到租约（§8.5）。
2. 连接中继的控制端口（7000），提交 `{subdomain, lease}`。
3. 中继用 `GET /mobile/relay-key` 的公钥验签（本地缓存），检查 `sub` 与租约 `sub` 一致、`exp` 未过期。
4. **挑战应答**：中继发随机 nonce，电脑用 `relay_public_key` 对应的私钥签名；中继验签，确认连接方持有租约里的公钥。防止租约被窃取后冒名顶替。
5. 同一子域名已有活跃连接时：新连接需先通过挑战；旧连接被替换并记录告警（可能是电脑重启，也可能是攻击）。
6. 租约剩余寿命 < 2 分钟时，中继通知电脑续期；电脑用最新心跳拿到的租约重签挑战。

> v1 实现说明：手机端固定桌面证书指纹（§5），租约被盗也冒充不了桌面，因此第 4–6 步的挑战应答在 v1 延后（见 §9.5）；电脑侧按心跳周期（30 秒，远早于租约 10 分钟到期）用新租约热更新 frpc，效果等同于续期。

### 9.5 实现方式（D8）

**首选：FRP + 本地鉴权插件**

- `frps` 提供数据面：`vhostHTTPSPort=443`（SNI 分流）、电脑接入端口、连接管理、限速。
- `frpc` 随电脑客户端内置，`type=https`，`customDomains=["dev-xxx.relay…"]`，本地转发到电脑网关（3443）。
- **客户端守护（T8，已实测）**：`frpc-supervisor` 每次心跳/注册把新租约原子写回配置，再调 frpc 的管理接口 `GET /api/reload` 让它生效——frpc 不监听配置文件变化；reload 被拒或代理报 `start error` 时杀掉进程并按 1→30 秒退避重起。`online` 只认 frpc `/api/status` 里的 `running`，不看进程是否存活。
- 在 frps 所在机跑一个**本地鉴权 sidecar**（200 行以内），通过 frps 的 `[[httpPlugins]]` 拦截 `Login` 和 `NewProxy`：
  - 校验租约 JWT（本地公钥，不回调后端）。
  - 校验 `NewProxy` 的域名与会话租约子域名一致。
  - 校验挑战应答。
- 每 24 小时从后端刷新公钥；遇未知 `kid` 立即刷新。
- 已实测（§9.3）：`NewProxy` 直接携带 `custom_domains` 与客户端自报的 `metas`，租约放 `metas.lease` 即可在校验阶段与域名比对，无需额外查询。
- `NewUserConn` 是每条用户连接的同步调用，在其中做网络往返会给每个连接加延迟；手机端已固定桌面证书指纹（§5），租约被盗也冒充不了桌面，因此挑战应答在 v1 可只对「未携带有效 `metas.lease` 的连接」触发。

**M0 必须先验证的事：**

1. frps 的 HTTPS vhost 是否**按 SNI 透传、不终止 TLS** —— **已实测通过**（2026-11-26，frp v0.72.0，本机源站 + frps + frpc 三进程模拟，脚本 `E:\work\code\mauwork\relay-poc\local-test.sh`）。正确 SNI 拿到的是源站自签证书（SHA-256 指纹与源站逐字节一致）；错误 SNI 直接 `no peer certificate`，不回退成中继自己的证书；HTTPS 页面经隧道取回成功。结论：frps 只解析 ClientHello 里的 SNI 做分流，不终止 TLS，D7「中继看不到内容」在 FRP 上成立，自研中继备选关闭。
2. 鉴权插件能否在 `NewProxy` 阶段拿到自定义域名 —— **已实测通过**（2026-11-26，frp v0.72.0）。`NewProxy` 的入参含 `user.user`、`user.run_id`、`proxy_name`、`proxy_type`、`custom_domains` 与客户端自报的 `metas`（frpc 配置字段名为 `metadatas`，线上 JSON 为 `metas`）；`Login` 含 `user`、`privilege_key`、`client_address`、`run_id`；`NewUserConn` 含 `proxy_name`、`remote_addr`，且 HTTPS 数据面经隧道取回成功。结论：§9.5 的「租约验签 + 域名一致性」可以全部落在 FRP 插件上，不需要自研中继。脚本 `E:\work\code\mauwork\relay-poc\plugin-test.sh`。
3. **租约验签 sidecar 全链路** —— **已实测通过**（2026-11-26）：假后端按 §8.5 签发真实 EdDSA 租约 → frpc `metadatas.lease` 提交 → sidecar 从 `/mobile/relay-key` 取公钥本地验签，校验 `did`（与 frpc `user` 一致）、`sub`（与 `custom_domains` 一致）、`exp`/`iat` → TLS 指纹与源站一致（继续证明不终止 TLS）；篡改签名的租约在 `NewProxy` 被拒（`bad-signature`），该域名随后无可服务证书。脚本 `E:\work\code\mauwork\relay-poc\lease-e2e.mjs`（7 项核对全过），sidecar 为 `relay-poc/lease-sidecar.mjs`。
4. **客户端 frpc 守护全链路（T8）** —— **已实测通过**（2026-11-26，frp v0.72.0）：假后端签发租约 → fork 的 `FrpcSupervisor` 驱动真实 frpc → sidecar 验签放行 → 经 frps 取回源站且证书指纹一致；心跳换新租约后经 `GET /api/reload` 热更新并再次通过 `NewProxy`；篡改租约被拒（frpc 状态为 `start error`）→ 守护替换进程 → 换回有效租约后恢复。脚本 `mauwork-mobile/tests/relay-live.test.ts`（设置 `DSH_MOBILE_RELAY_FRPS` / `DSH_MOBILE_RELAY_FRPC` 指向真实二进制时运行）。
5. 手机 WebSocket 经 FRP 透传是否稳定（长连接、心跳、重连）——需手机端联调，M4 后验证。

**备选：自研最小中继（Go）**

- FRP 透传已验证通过，本备选关闭；仅当 FRP 无法满足下面的鉴权或限额要求时才重启。范围严格限定为：SNI 读取、连接表、租约验签、挑战应答、双向 splice、限速、指标。
- 不自行实现 TLS/加密算法，只用标准库。
- 预估 5–8 人日 + 测试。

### 9.6 限额与滥用防护

- 每子域名并发连接上限（建议 20）；每 IP 新建连接速率限制（建议 10/秒）。
- 每设备字节限速（建议 2–5 Mbps 峰值），避免单用户吃满带宽。
- 空闲超时（无字节 10 分钟断开）；连接总时长不限制。
- 未登记子域名一律拒绝并计数；连续探测 IP 拉黑 10 分钟。
- 阿里云免费 Anti-DDoS Basic 开启；不引入 WAF（透传模式 WAF 无法解析）。
- 不提供开放代理：只有持有租约的电脑能建立回源连接，子域名只能是后端分配格式。

### 9.7 可观测性

- 指标：在线电脑数、活跃子域名、并发连接、入/出字节、握手失败、租约拒绝、挑战失败。
- 日志：`deviceId`（来自租约）、`subdomain`、源 IP、字节数、时长、结果码；不记 URL、Header、内容。
- 告警：进程退出、443 不可用、在线设备数骤降、租约拒绝率突增。
- 健康检查：`GET /healthz` 仅内网。

### 9.8 故障与容灾（v1 边界）

- 中继进程崩溃：systemd 3 秒拉起；电脑 frpc 指数退避重连；手机页面自动重连（现有网关能力）。
- 中继整机故障：v1 接受中断（单点），人工切换备用机（改 DNS 或换 IP）。**多中继容灾列入 v2**，不在本期实现。
- 后端故障：不影响已建立的中继连接；租约 10 分钟内仍有效；超过 10 分钟电脑断开回源，但已配对的局域网连接仍可用。
- 证书/指纹变化：电脑重新上报指纹，手机下次拉清单更新；不匹配时拒绝连接并提示重新连接。

### 9.9 容量估算

| 场景 | 单用户平均 | 说明 |
|---|---|---|
| 纯文字对话 | 5–20 kbps | 心跳与增量事件 |
| 工具输出滚动 | 50–200 kbps 峰值 | 短时突发 |
| 图片/文件预览 | 1–5 Mbps 峰值 | 大文件是带宽主要来源 |

- 10 Mbps ≈ 同时 100–200 人在线对话，或 2–3 人同时拉大图。
- 起步建议：内部测试 5 Mbps；公开测试 20–50 Mbps 或按流量计费，按实测调整。
- 连接数不是瓶颈，带宽才是；先监控字节曲线再扩容。

### 9.10 中继验收

| # | 场景 | 通过标准 |
|---|---|---|
| R1 | 正常回源 | 电脑连上，手机经子域名打开页面 |
| R2 | 未登记子域名 | 拒绝，无回源连接 |
| R3 | 无租约/过期租约 | 拒绝建立回源连接 |
| R4 | 租约被窃取但无私钥 | 挑战失败，拒绝 |
| R5 | 同子域名重复连接 | 新连接替换旧连接并告警 |
| R6 | 中继重启 | 电脑 30 秒内重连，手机自动恢复 |
| R7 | 限速 | 单设备超限被压到配置值，其他设备不受影响 |
| R8 | 透传验证 | 中继侧抓包只看到 TLS 记录，无明文 HTTP |
| R9 | 指纹不匹配 | 手机拒绝连接并提示 |
| R10 | 后端不可用 | 已建立连接不受影响，租约到期前不中断 |

---

## 十、桌面端改动（本仓库，改动很小）

### 10.1 新增 Host-only 账号会话读取（本仓库唯一的功能性代码改动）

**文件**：`packages/credentials/mio-account/src/service.ts`

```ts
/** Host-only business session handed to sibling plugins. Never exposed through a Remote method. */
export interface MioBusinessSession {
  readonly token: string
  readonly userId: string
}

export abstract class MioAccount extends Service {
  /** Reads the stored business session without network access. @returns the session, or null when signed out. */
  abstract getBusinessSession(): Promise<MioBusinessSession | null>
  /** Reads the configured business origin so sibling plugins need no second deployment setting. */
  abstract getBusinessBaseUrl(): string
}
```

**实现**（`src/index.ts`）：读取 `SESSION_KEY`；无记录或 `user === null` → `null`；否则 `{ token: session.accessToken, userId: session.user.userId }`。`getBusinessBaseUrl()` 返回构造时归一化的 `businessBaseUrl`（含可选路径前缀，不含 `/mio/client/v1`）。两者都不缓存业务数据、不发请求、不写日志。

**测试**（`tests/account.spec.ts`）：未登录 → null；已登录 → token+userId；无 user/损坏 → null；base URL 归一化且不发请求；断言 `mio-account-controller` 的 Remote 方法集合**没有**新增项。

**文档**：README 双语 Use-this-package 各加一行；Model Experience 仍为 None；KV Cache 不变。

### 10.2 桌面发行版打包

- fork 发布名 `@mauwork/mobile-access`，加入桌面默认 profile 的插件清单，锁版本、默认启用。
- **内置 frpc 二进制**（按平台随包），不在运行时从网上下载。校验方式：打包时固定 SHA-256，启动前校验。
- 发布前 smoke：启动桌面 → 登录 → 手机能看到本机 → 连接成功 → 中继断开后 30 秒内恢复。

---

## 十一、桌面插件改动（saya-ch/dsh-mobile fork）

### 11.0 仓库与命名

- 仓库名 `mauwork-mobile`，npm 包 `@mauwork/mobile-access`。
- 保留 Apache-2.0 `LICENSE`，新增 `NOTICE`：「forked from saya-ch/dsh-mobile, modified by Mauwork」。
- **不重写网关与配对核心**，只加旁路模块，便于 cherry-pick 上游安全修复。
- 目录结构以上游现状为准；新增代码集中在 host 的 `directory/`、`relay/` 与 client 的 `settings/`。

### 11.1 新增模块清单

```
host/src/directory/
  config.ts           配置 schema 与默认值
  store.ts            $DSH_HOME/mobile-access/directory.json 原子读写
  directory-client.ts 调后端：register / heartbeat / delete
  registrar.ts        账号状态机：登录检测、注册、心跳、退避
  runtime.ts          组装会话/凭据/客户端/守护，暴露 ready/status/refresh/stop
  host-seams.ts       对 Host 的 mioAccount 与 credentials 的结构化视图
  relay-key.ts        Ed25519 中继密钥：首次生成存凭据 seam，重启复用
  nonce-store.ts      ticketId → exp，持久化，防重放（T9）
  redeem.ts           配对票兑换（验签 + 审批 + 复用现有配对写入，T9）
  origins.ts          地址收集（LAN + 中继公网地址）+ 指纹计算（T10）
  approvals.ts        待审批队列（内存 + 超时，T9）
  tests/*
host/src/relay/
  frpc-binary.ts      定位随包 frpc
  frpc-config.ts      生成 frpc.toml（租约、子域名、admin 端口）
  frpc-supervisor.ts  启动/守护 frpc、写租约、reload、退避重起
  tests/*
client/src/settings/  「手机连接」页 + 审批弹窗
```

### 11.2 配置

```ts
interface Config {
  enabled: boolean             // 默认 true
  // 后端地址不重复配置：运行时取 ctx.mioAccount.getBusinessBaseUrl()（见 §10.1）
  deviceName?: string          // 默认 os.hostname()
  requireApproval: boolean     // 默认 false：同账号直接放行；true 恢复人工确认
  approvalTimeoutMs: number    // 默认 60_000
  heartbeatIntervalMs: number  // 默认 30_000（±20% 抖动）
  allowInsecureLan: boolean    // 默认 false，仅开发
}
```

`directory.json`：
```json
{
  "version": 2,
  "deviceId": "uuid-v4",
  "deviceName": "张三的 MacBook",
  "relay": { "subdomain": "", "publicUrl": "", "endpoint": "" },
  "relayPublicKey": "base64url(SPKI)",
  "lastRegisteredAt": 1763000000000,
  "removedFromAccount": false
}
```
- 原子写；`deviceId` 生成后不变；损坏 → 备份 `.corrupt-<ts>`，重新生成 deviceId 并注册，页面提示一次。
- 中继密钥对（Ed25519）：首次生成，私钥存本机凭据 seam，公钥随注册上报；**私钥不写普通 JSON**。

### 11.3 状态机

```
disabled
  → waiting-account    无登录 / 退出 / 401 / session-expired
  → registering        POST register
  → relay-connecting   用租约连中继（frpc）
  → online             frpc 已连 + 心跳成功（中继可分流）
  → backoff            心跳或中继失败：30/60/120/300 秒
  → removed            known:false，停止 frpc 与上报，等「重新添加」
  → blocked            账号不可用（backend account ≠ active / HTTP 403），停止上报
```

- 登录状态来自 `ctx.get('mioAccount')` 的 `getState()`/`watch()`；token 来自 `getBusinessSession()`。
- `online` 的条件是**两者都成立**：后端心跳成功 + frpc 已连上中继。只满足一项时页面显示对应原因。
- 账号目录不可用不阻塞本机扫码配对。
- 日志：`state`、`httpStatus`、`backendCode`、`traceId`、`deviceId`、`subdomain`；禁止 token、票原文、租约原文。

### 11.4 配对票兑换与审批

#### `POST /mobile-access/directory/redeem`（TLS 必须）

请求：
```json
{ "ticket": "<JWS>", "phoneDeviceId": "uuid", "phoneName": "Pixel 9",
  "phonePublicKey": "base64url(SPKI P-256)", "timestamp": 1763000012345,
  "signature": "base64url(ECDSA-P256-SHA256 over `sha256(ticket)|phoneDeviceId|timestamp`)" }
```
顺序（任一失败统一 `400 directory/redeem-rejected`，仅日志区分）：
1. JWS 校验（§8.4 全部 7 步）。
2. `abs(now - timestamp) <= 120_000`。
3. 用 `phonePublicKey` 验签。
4. `ticketId` 写 nonce-store；重复即拒；保留 10 分钟。
5. 已批准同一 `(phoneDeviceId, phonePublicKey)` → 调用**现有 QR 配对内部函数**签发/轮换该 Origin 的 token → `200 { token, origin, host }`（`origin` 是完整 Origin，如 `https://192.168.111.26:3445`；`host` 是同一 Origin 的 authority，默认 443 省略端口，即 `new URL(origin).host`）。
6. `requireApproval === false`（默认）：直接调用同一函数签发 token → `200`，并向桌面页推送「新设备已连接」通知与审计记录；通知提供「断开」按钮。
7. `requireApproval === true`：入审批队列 → `202 { approvalId, expiresAt }`；通过后出队时调用**同一个**函数签发 token。

**约束**：第 5、7 步必须复用上游扫码配对的设备写入与 token 签发函数（附录 A），不得另写一套。

#### `POST /mobile-access/directory/approval-status`

请求 `{ approvalId }`；响应 `{ status: pending|approved|denied|expired, token?, origin?, host? }`。token 只返回一次；approved 后立即销毁。手机每 2 秒轮询，60 秒超时。`origin`/`host` 语义与 redeem 的 200 响应一致，手机必须校验二者都与发起 redeem 的地址相符，否则按「无法识别的响应」处理。

#### 本机管理接口（沿用插件现有管理鉴权：loopback peer + Origin + CSRF）

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/mobile-access/directory/status` | 账号状态、deviceId、子域名、中继连接、地址、指纹、上次心跳 |
| GET | `/mobile-access/directory/approvals` | 待审批列表 |
| POST | `/mobile-access/directory/approvals/{id}` | `{ allow: true/false }` |
| POST | `/mobile-access/directory/rename` | `{ name }` |
| POST | `/mobile-access/directory/re-add` | 清 `removedFromAccount` 并立即注册 |
| POST | `/mobile-access/directory/leave-account` | 调 DELETE 并置 `removedFromAccount: true` |

### 11.5 地址与指纹

- LAN：枚举非回环 IPv4，优先 RFC1918，最多 5 条，`https://<ip>:<lanPort>`，`stable:false`。
- 公网：`https://<subdomain>.relay.<domain>`，来自后端注册响应，`stable:true`。
- TLS 证书：沿用每装机自签证书（现有私有 CA 能力）；计算证书 SHA-256，作为 `tlsFingerprint` 随注册上报。
- 证书重新生成（重装/更换网络导致重签）时，重新上报指纹。
- 允许「在线但无地址」：照常注册，`origins: []`。

### 11.6 裁剪与关闭危险面（自建中继后面积大幅缩小）

- **删除全部第三方隧道模块**：cloudflared、Tailscale、cpolar、FRP 客户端管理、Caddy、iroh，连同二进制下载、校验、菜单、文档整目录移除。
- 只保留：局域网 HTTPS + 内置 frpc（连自家中继）。
- 删除 `extensions/host.mjs` 注册表与执行链；删除远程触发 `/mobile` 改文件的能力。
- `mobile.css` / `mobile.js` 只随包只读发布，不提供运行期修改入口。
- 保留并核对：局域网私有 CA、设备 token 摘要、电脑端吊销、同 Origin 续期。
- 品牌：全部改 Mauwork；沿用 fork 自有 i18n。

### 11.7 测试

- 单元：JWS 验签（有效/过期/kid 未知/签名错/uid 不匹配）、nonce 一次性、审批超时、状态机、原子写、损坏恢复、租约解析、挑战签名。
- 集成：假后端（实现 §8 的 7 个接口）+ 假中继（记录连接与租约）；跑通注册→心跳→frpc 连接→兑换。
- 真实组合：stub `mioAccount` + 真网关 + 假中继，完成一次兑换并访问受保护接口。
- 测试不打真实外网。

---

## 十二、移动端改动（Android，saya-ch App fork）

### 12.1 屏幕与导航

| 屏幕 | 内容 |
|---|---|
| 启动 | 读本地账号 token → 有效进「我的电脑」，无效进登录 |
| 登录 | 手机号 + 短信验证码；切换密码登录；协议链接 |
| 我的电脑 | 设备卡片：名称、在线点、平台、最后在线；下拉刷新；可见时 30 秒自动刷新；右上角「扫码连接」 |
| 等待确认 | 仅 `requireApproval=true` 时出现；「请在电脑上点允许」+ 取消；60 秒倒计时 |
| 会话 | 现有 WebView 页面，不改 |
| 设置 | 账号信息、退出登录、关于、扫码连接 |

**不改的部分**：WebView 壳、页面注入、通知、会话抽屉。移动端只加「登录 + 设备列表 + 连接编排 + 指纹校验」。

### 12.2 本地存储

| 数据 | 位置 | 说明 |
|---|---|---|
| 账号 access token | Android Keystore（EncryptedSharedPreferences） | 只用于目录接口；401 → 回登录页 |
| 手机密钥对（P-256） | Android Keystore，别名 `mauwork-phone-key` | 私钥不可导出 |
| 每台电脑的设备 token | Keystore 加密的 DataStore | `{ hostDeviceId → { name, fingerprint, tokens: { origin → { token, savedAt } } } }` |
| 每台电脑的 TLS 指纹 | 同上 | 首次配对与每次刷新清单时更新 |
| 账号密码 | 不存 | — |

- 账号登出：清账号 token；保留电脑 token（不变量 6），设置页提示。
- 卸载 = 全部清空。

### 12.3 连接算法

```
输入：选中的 host（origins[] + tlsFingerprint）
排序：
  1. 手机 Wi-Fi 网段与某 LAN 地址前三段相同 → LAN 优先
  2. stable:true 优先
  3. 其余按后端返回顺序
逐个尝试，每个地址 2 秒超时，总计 ≤ 8 秒：
  1. 建 TLS：
     - 公网中继地址：用后端给的 tlsFingerprint 校验证书（不校验主机名）
     - 局域网地址：沿用现有私有 CA 固定
     - 指纹不匹配 → 中止，重新拉清单；仍不匹配 → 报「电脑身份校验失败」
  2. 本地有该 Origin 的 token：
       200 → 打开 WebView
       401 → 删该 Origin token，进入 3
       超时/网络错 → 下一个地址
  3. 配对：
       POST /mobile/pair-tickets（409→离线；429→限流）
       POST {origin}/mobile-access/directory/redeem
         200 → 存 token → 打开
         202 → 「等待确认」，每 2 秒轮询，60 秒超时
```

- 同一台电脑同时只允许一个连接流程（互斥锁）。
- 地址与指纹缓存 30 秒；打开列表时后台刷新。
- WebView 内 401：清 token 并重新走 3。

### 12.4 错误与文案（用户可读）

| 情况 | 文案方向 |
|---|---|
| 电脑离线 | 「这台电脑现在不在线，最后在线：x 分钟前」 |
| 在线但无地址 | 「电脑在线，但当前没有可用连接地址」 |
| 指纹不匹配 | 「无法确认这台电脑的身份，请重试；如持续出现请联系支持」 |
| 等待确认超时 | 「电脑没有响应确认，请重试」 |
| 被电脑移除 | 「这台电脑已移除本机授权，请重新连接」 |
| 账号过期 | 回登录页 |
| 版本过低 | 「请升级 App 后重试」 |

### 12.5 安全要求

- 账号 token、设备 token、私钥只存 Keystore；不进日志、不进 WebView JS。
- 公网中继路径**必须**做指纹校验；不能因为"经过自家中继"就放松。
- redeem 与轮询走原生 HTTPS，token 通过现有凭据注入路径交给 WebView，不得放 URL。
- 通知内容沿用锁屏脱敏。
- 账号登出不清设备 token（不变量 6），但设置页明确说明。

### 12.6 测试

- 单元：地址排序、指纹校验、token 命中与 401、轮询状态机、存储迁移。
- UI：登录 → 列表 → 连接 → 等待 → 各错误态。
- 真机：局域网、中继公网、Wi-Fi↔5G 切换、两手机并发、断网重连、换 IP、吊销、指纹变化。
- 性能：有缓存地址时，冷启动到可点击 < 2 秒。

---

## 十三、端到端验收清单

| # | 场景 | 通过标准 |
|---|---|---|
| 1 | 桌面登录后注册 | 30 秒内手机列表出现，名称、子域名正确 |
| 2 | 桌面退出登录 | 90 秒后显示离线；已配对手机仍可局域网连接 |
| 3 | 首次配对 | 手机点电脑 → 电脑弹确认 → 允许 → 进入会话 |
| 4 | 拒绝配对 | 手机提示被拒绝，不签发 token |
| 5 | 审批超时 | 60 秒后手机提示超时，队列清空 |
| 6 | 局域网连接 | 发消息，电脑端实时可见 |
| 7 | 中继连接 | 手机关 Wi-Fi 用 5G，经子域名连上并继续同一会话 |
| 8 | 地址变化自动重配 | 换 IP/换网络后手机自动重配，无需扫码 |
| 9 | 票重放 | 第二次兑换被拒 |
| 10 | 票伪造/篡改 | 拒绝 |
| 11 | 跨账号 | 拿不到票，也兑换不了 |
| 12 | 过期票 | 超过 120 秒拒绝 |
| 13 | 电脑吊销手机 | 手机下次请求 401 并清 token |
| 14 | 从账号移除电脑 | 电脑停止中继连接；最迟 10 分钟中继断开；二维码仍可用 |
| 15 | 重新添加 | 恢复上报；手机需再次确认 |
| 16 | 纯扫码兜底 | 不登录账号，行为与改造前一致 |
| 17 | 后端不可用 | 二维码可用；已建立的中继连接在租约期内不中断 |
| 18 | 中继不可用 | 电脑退避重连；手机提示；后端功能不受影响 |
| 19 | 两手机并发 | 同一会话两端同时观看，消息实时同步 |
| 20 | 时钟偏差 | 电脑快/慢 2 分钟仍可兑换 |
| 21 | 指纹不匹配 | 手机拒绝连接；不降级为"忽略证书" |
| 22 | 租约盗用 | 无私钥的第三方连接被挑战拒绝 |
| 23 | 未登记子域名 | 中继拒绝，无回源 |
| 24 | 安全抓包 | 中继侧只见 TLS 密文；账号密码、模型 key、会话内容均不出现在后端接口 |
| 25 | 手机登录不踢桌面 | 手机登录后，桌面会话仍有效（多端并存） |
| 26 | 手机登出不踢桌面 | 手机退出只清本机；桌面保持登录（后端只能全局撤销时不调 logout，仅清本地） |
| 27 | 同账号自动放行 | 新手机无需确认直接进入；桌面出现「新设备已连接」通知，可一键断开 |
| 28 | 关闭自动放行 | 电脑把 `requireApproval` 置 true 后，新手机恢复需要确认 |
| 29 | 手机 token 范围（若加 scope） | 手机 token 调 `/models/config` 返回 403；桌面不受影响 |
| 30 | 密码重置影响 | 手机重置后明确提示桌面会退出登录 |

## 十四、里程碑（中继独立，可与后端并行）

| 阶段 | 内容 | 工期 | 出口条件 |
|---|---|---|---|
| M0 | 拍板 D1–D11；FRP SNI 透传**已验证通过**；登录复用**已确认**（§8.8 第 1 问）；假后端**已落地**（`E:\work\code\mauwork\fake-backend`，14 项核对过）；假中继**已打通**（`relay-poc/lease-e2e.mjs`：租约签发→sidecar 验签→透传→篡改拒绝，7 项过） | 1–2 天 | 剩余三问有答案；契约不再变；假服务能跑通全流程 |
| M1 | 后端：表 + 7 个接口 + 配对票/租约签发 + 限流 | 3–5 天 | 跨账号、过期、限流用例通过 |
| M2 | 本仓库：`getBusinessSession` + 测试 + 打包 | 1–2 天 | 单测通过；桌面启动插件能拿到会话 |
| M3 | 中继：FRP + 鉴权 sidecar + 通配符解析 + 限速 + 指标（用假租约） | 3–5 天 | R1–R10 全部通过 |
| M4 | 插件：directory + relay 模块 + 审批页 | 7–10 天 | 假后端+假中继走通首次配对与在线状态 |
| M5 | Android：登录 + 列表 + 连接 + 指纹 + 自动重配 | 7–10 天 | 验收 1–8、13 通过 |
| M6 | 加固发行：裁剪、品牌、验收 9–24、真机联调 | 5–7 天 | 全清单通过，可发内部测试版 |

> 2 人约 4–6 周；1 人约 8–10 周。若 M0 判定 FRP 不可用，M3 切换自研中继，增加 1–2 周。

## 十五、给 AI 的任务分解

| ID | 归属 | 任务 | 依赖 | 完成标准 |
|---|---|---|---|---|
| T1 | 后端 | 建表 + register/heartbeat/list/delete + 子域名分配 | M0 | 单测通过；跨账号 404 |
| T2 | 后端 | 配对票 + 租约签发 + 两个公钥端点 + 限流 | T1 | 验签用例通过；429 生效 |
| T3 | 本仓库 | `getBusinessSession` + 测试 + README 双语 | M0 | 相关测试过；Remote 不新增方法 |
| T4 | 中继 | FRP + 鉴权 sidecar + 通配符 DNS + 证书方案 | M0 | R2–R5 通过 |
| T5 | 中继 | 限速、连接上限、指标、日志、systemd | T4 | R6–R10 通过 |
| T6 | fork | directory 配置、store、nonce-store | M0 | 单测：原子写、损坏恢复、一次性 |
| T7 | fork | registrar + directory-client（注册/心跳/退避） | T6 | 假后端下状态流转正确 —— **已完成（2026-11-26）**：11 项单测 + 假后端集成用例（注册/心跳/删除后停止/换密钥重注册）全过 |
| T8 | fork | relay：frpc 守护、租约续期（挑战应答 v1 延后，见 §9.5） | T6 | 假中继下能连、能重连、能续租 —— **已完成（2026-11-26）**：真实 frps/frpc + sidecar 全链路（连接、TLS 透传、续租 reload、拒签恢复）通过 |
| T9 | fork | redeem + approval（复用上游配对写入） | T7 | 首次兑换成功、重放拒绝、跨账号拒绝 |
| T10 | fork | origins + 指纹计算上报 | T7,T8 | 地址/指纹正确；无地址时照常注册 |
| T11 | fork | 「手机连接」页 + 审批弹窗 + 状态展示 | T9,T10 | 页面可看、可允许/拒绝、可改名/移除 |
| T12 | fork | 裁剪全部隧道与 `host.mjs`、品牌替换 | T11 | 构建无残留引用；扫码流程回归通过 |
| T13 | Android | 登录 + 我的电脑列表 | T2 | 真机登录、列表、刷新、离线态正确 —— **已完成（2026-11-26）**：API 36 模拟器 + 假后端实测短信登录、列表排序、手动刷新、离线/最后在线、空列表、重启后会话保留、401 回登录页带失效提示、15 秒自动刷新；18 项单测（8 HTTP + 6 解析 + 4 存储）通过，lint 通过 |
| T14 | Android | 连接编排 + 存储 + 指纹校验 + 自动重配 | T9,T13 | 验收 3–8、13、21 通过 |
| T15 | Android | 错误文案 + 设置 + 扫码兜底 | T14 | 验收 16、17 通过 |
| T16 | 联合 | 验收 1–24 + 抓包检查 | 全部 | 全过 |

**本仓库开发规范（T3 必读）**：ESM + 本地相对导入带 `.ts`；注册走 `ctx.effect()`/`ctx.on()`；错误用 `HarnessError`；不得新增 `as unknown`；导出必须有 JSDoc（`@param`/`@returns`）；改包同步 README 双语；新建文件 LF；提交前 `pnpm run typecheck`、相关测试、`pnpm run lint`。

**fork 规范**：沿用其构建与测试；若在 monorepo 内开发，同样受 `verify-client-ui-i18n` 与包 README 规则约束。

## 十六、风险与回退

| 风险 | 影响 | 对策 |
|---|---|---|
| FRP 不透传 TLS | 中继可解密，违背 D7 | **已排除**（2026-11-26 实测透传成立，见 §9.3） |
| 账号后端不能加接口/表 | 方案不成立 | M0 第一件事确认；否则退回纯扫码 |
| 中继单点故障 | 远程全断 | systemd 快速重启 + 监控；v2 多中继；公告维护窗口 |
| 带宽被单用户吃满 | 其他人卡顿 | 每设备限速；按实测扩容；图片/文件后续做压缩 |
| 后端被攻破 → 下发假指纹 | MITM | 后端最小权限、密钥 KMS；首次配对电脑显示 6 位校验码供人工核对 |
| 账号 token 泄露（D5 自动放行后） | 攻击者可绑定并完全控制所有在线电脑 | 手机 token 限 scope（D11）；桌面通知 + 一键断开；异常地区/频率告警；后续加 2FA 与闲置断开 |
| 证书重签导致指纹变化 | 连接失败 | 自动重拉指纹；变化时在电脑页面提示；极端情况重新配对 |
| 插件第三方代码 | 本机 RCE | 删 `host.mjs`；锁版本；cherry-pick 安全修复；发布前 grep 残留 |
| 公网被扫描/探测 | 噪音与滥用 | 未登记子域名拒绝、IP 限速、拉黑、Anti-DDoS |
| 用户不理解"内容只在电脑上" | 投诉 | 首次连接一句话说明；离线态文案写清楚 |
| 备案延误 | 大陆不能上线 | 内部测试用香港；正式版提前 3 周启动备案 |

**总开关**：`directory.enabled=false` 即回到纯扫码；本机配对与已有 token 不受影响。

---

## 附录 A：上游代码定位清单（开发前必须回填）

在 fork 仓库中定位并记录真实路径与函数名，写进本文末尾的「实现映射」：

- [ ] 配对码生成与兑换处理函数（搜索 `pair`、`pairing`、`qrcode`、`/mobile-access/` 路由注册）
- [ ] 设备记录持久化（`deviceToken`、`tokenHash`、随机设备标识）
- [ ] 设备 token 签发与校验中间件（`authentication_failed`、`Bearer`、cookie）
- [ ] 「移动访问」设置页组件与路由（client 侧）
- [ ] 局域网 HTTPS 监听与私有 CA 生成（`3443`、`createCA`、`pem`）
- [ ] 回环代理目标端口的读取方式（确认是否假设 3080；改为 `ctx.webServer.port`）
- [ ] 隧道模块注册表（整目录删除）
- [ ] `extensions/host.mjs` 注册表与执行入口（整体移除）
- [ ] Android token 注入 WebView 的路径（复用）
- [ ] Android 设备列表存储（复用样式）
- [ ] 现有证书生成是否可导出证书 SHA-256 指纹（中继透传所需）

## 附录 B：评审时需要拍板的问题

1. D9：香港还是大陆？大陆需备案，等 1–3 周。
2. D11：后端能否给手机发受限 token、能否单 token 登出？（决定 §8.8 走哪条）
3. D8：FRP SNI 透传已实测通过（§9.3）；仍待确认鉴权 sidecar 能否在 `NewProxy` 阶段拿到自定义域名。
4. D5 已定为同账号放行：是否接受「桌面通知 + 一键断开」作为补偿控制？（推荐接受）
5. 首次配对是否加「6 位校验码」人工核对？（推荐加，防后端被攻破）
6. 是否允许密码登录，还是只短信？（默认都开）
7. 账号登出后保留已配对手机？（默认保留）
8. Android 最低版本？（沿用 fork：Android 8+）
9. 是否需要 iOS/PWA？v1 只做 Android。
