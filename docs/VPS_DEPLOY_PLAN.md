# VPS_DEPLOY_PLAN: Một VPS tự host (không Docker), OmniRoute là provider model duy nhất

> **Trạng thái:** BẢN NHÁP để anh review. Chưa thay đổi code hay hạ tầng nào.
> **Ngày:** 26/10/2026 (ICT, UTC+7).
> **Thay thế:** kế hoạch Cloud Run + Turso đang tạm dừng (`deploy/cloudrun/deploy.sh`, `apps/copilot/DEPLOY.md` mục Postgres/Turso). Đồng thời bỏ Render Oregon (`render.yaml`), nơi từng bị Binance trả HTTP 451.
> **Ký hiệu:**
> - **[đo]**: số liệu tự đo trên box Linux x64 ngày 26/10/2026, ở commit `61b86fc5` (hoặc mới hơn).
> - **[giả định]**: chưa đo hoặc ước lượng.
> - **[chưa xác minh]**: không tìm được nguồn chắc chắn.

---

## 0. Tóm tắt một trang
- **Kích thước VPS:**
  - **2 vCPU / 2 GB RAM là mức tối thiểu thực tế. 1 GB không đủ.**
  - Lý do: chỉ riêng OmniRoute 3.8.52 khi rảnh đã chiếm **~490–560 MB RSS [đo]**. Copilot (uvicorn) rảnh ~170 MB, đỉnh ~280 MB khi nạp `exchangeInfo` [đo].
  - Nếu ngân sách cho phép, 4 GB thoải mái hơn và có chỗ cho engine tự động.
- **Web:**
  - Chuyển sang **Next static export** (`out/` chỉ **1,4 MB [đo]**). Caddy phục vụ file tĩnh và reverse-proxy `/v1/copilot/*` thẳng tới uvicorn.
  - Bỏ hẳn process Node của web, tiết kiệm **~95 MB RSS [đo]** của Next standalone.
  - Điều kiện: bỏ hoặc tắt có điều kiện route proxy `apps/web/app/v1/copilot/[...path]/route.ts`. Đã thử build export thành công khi tạm bỏ route này.
- **API:** `uvicorn` **1 worker**, bind `127.0.0.1:8000`. Drain loop trong `app.py` và rate limiter in-memory (`rate_limit.py`) đều giả định chỉ có một process.
- **DB:**
  - **SQLite chế độ WAL** tại `/var/lib/cryptosignal/copilot/sessions.sqlite3`.
  - Backup offsite bằng **Litestream v0.5.17** lên S3-compatible, cộng `sqlite3 .backup` hằng ngày.
  - Không cần Postgres ở quy mô này.
- **TLS và biên:** Caddy (tự động HTTPS, ~49 MB RSS [đo]). Hoặc Cloudflare Tunnel nếu không muốn mở cổng 80/443.
- **OmniRoute:**
  - Chạy với `--headless`, `OMNIROUTE_SERVER_HOST=127.0.0.1`, `OMNIROUTE_MEMORY_MB=384–512`, systemd service riêng.
  - **Cảnh báo:** mặc định nó bind `0.0.0.0` [đo] và `REQUIRE_API_KEY=false`. Phải bind loopback và đặt firewall.
  - Provider `cursor/*` cần `cursor-agent` CLI và đăng nhập, nên khó chạy trên VPS. Đề xuất chỉ dùng `agentrouter/*`.
- **Vị trí:** Singapore (DigitalOcean/Vultr) hoặc VN (BizFly). **Không đặt ở Mỹ** (Binance 451).
- **Engine tự động** (`docs/AUTO_ANALYSIS_SPEC.md`): service systemd riêng, `Nice=10`, `MemoryMax`. Không chạy chung process với uvicorn.

---

## 1. Hiện trạng trong repo

| File | Nội dung | Tác động |
|---|---|---|
| `DEPLOY.md` | Web lên Vercel, copilot lên Render | Thay bằng VPS |
| `render.yaml` | Plan free, region **oregon** | Không đổi region khi chưa có OK của anh. Kế hoạch này chỉ *bỏ dùng* Render sau khi VPS chạy ổn. |
| `deploy/DEPLOY.md`, `deploy/docker-compose.yml` | VPS bằng Docker Compose: web :3000 proxy tới copilot :8000, có profile Postgres 16 | Kế hoạch này **không dùng Docker**, nhưng tái dùng ý tưởng proxy |
| `deploy/cloudrun/deploy.sh` | Cloud Run `asia-southeast1`, min-instances 0, timeout 600, Secret Manager | Kế hoạch đang dừng, thay thế |
| `apps/copilot/Dockerfile`, `apps/web/Dockerfile` | python:3.12-slim; node:22-alpine standalone | Tham khảo bước build |
| `apps/copilot/pyproject.toml` | fastapi, uvicorn[standard], pydantic-ai (bản **đầy đủ**), httpx, sqlalchemy, alembic, **psycopg[binary]** | Đề xuất làm gọn (§10) |
| `apps/copilot/src/cryptosignal_copilot/config.py` (`load_database_url`) | `DATABASE_URL` → `COPILOT_SESSIONS_DB` → `COPILOT_DATA_DIR/sessions.sqlite3` → **`/tmp`** | Phải đặt `COPILOT_DATA_DIR`, nếu không sẽ mất dữ liệu khi reboot |
| `db/engine.py` | `create_engine(url, pool_pre_ping=True)`, SQLite `check_same_thread=False`, **chưa bật WAL** | Đề xuất bật WAL (§4) |
| `app.py` | Drain loop toàn cục, keepalive SSE mỗi 12 s, migration khi `COPILOT_RUN_DB_MIGRATIONS` | Chạy 1 worker. Keepalive 12 s thỏa giới hạn của Cloudflare. |
| `symbol_tick.py` | Tải `exchangeInfo` (~17,8 MB) bằng urllib đồng bộ, cache trong RAM | +114 MB RSS đỉnh, 2,56 s [đo]. Đề xuất sửa (§10) |
| `klines.py` | `data-api.binance.vision` | Phải truy cập được từ VPS (§11) |
| `apps/web/next.config.ts` | `output: "standalone"` | Chuyển sang `export` (§3) |
| `apps/web/app/v1/copilot/[...path]/route.ts` + `lib/server/copilot-proxy.ts` | Route handler duy nhất (proxy, `force-dynamic`) | Chặn static export. Caddy làm thay vai trò này. |
| `apps/web/lib/copilot-api.ts` | Client gọi `NEXT_PUBLIC_COPILOT_URL` nếu có, nếu không thì gọi cùng origin `/v1/copilot/*` | Để trống ⇒ cùng origin, đúng với Caddy |
| `docs/OMNIROUTE_CONFIG.md`, `apps/copilot/config/omniroute.env.example` | OmniRoute 3.8.51 trên Mac `127.0.0.1:20128`, `LLM_MODEL=agentrouter/deepseek-v4-flash`, `LLM_TIMEOUT_S=180` | Tái dùng trên VPS |

---

## 2. Bố cục hệ thống (systemd, không Docker)

```
Internet ──443──► Caddy (cryptosignal-caddy / caddy.service)
                   ├─ /            → file tĩnh /srv/cryptosignal/web/current/  (Next export)
                   └─ /v1/copilot/* → 127.0.0.1:8000  (flush ngay, SSE)
127.0.0.1:8000  ◄─ cryptosignal-copilot.service   (uvicorn, 1 worker, user cryptosignal)
127.0.0.1:20128 ◄─ omniroute.service              (omniroute serve --headless, user omniroute)
                   cryptosignal-autoscan.service  (Phase sau; đọc/ghi cùng SQLite)
                   litestream.service             (stream WAL → S3-compatible)
```

**User và thư mục:**
- Hai user hệ thống `cryptosignal` và `omniroute`, không có shell đăng nhập.
- Code: `/srv/cryptosignal/{copilot,web}/releases/<sha>`, symlink `current`.
- Dữ liệu: `/var/lib/cryptosignal/copilot/`, `/var/lib/omniroute/` (`DATA_DIR`).
- Biến môi trường: `/etc/cryptosignal/copilot.env`, `/etc/omniroute/omniroute.env`, quyền `0600`, chủ sở hữu là user service. **Không commit**, không đặt trong repo.

**Unit `cryptosignal-copilot.service` (phác thảo cấu hình):**
- `ExecStart=/srv/cryptosignal/copilot/current/.venv/bin/uvicorn cryptosignal_copilot.app:app --host 127.0.0.1 --port 8000 --workers 1 --proxy-headers --forwarded-allow-ips 127.0.0.1 --timeout-keep-alive 75`
- `EnvironmentFile=/etc/cryptosignal/copilot.env`
- `COPILOT_DATA_DIR=/var/lib/cryptosignal/copilot`, `COPILOT_RUN_DB_MIGRATIONS=1`
- `Restart=on-failure`, `MemoryHigh=400M`, `MemoryMax=600M` (trên VPS 2 GB) **[giả định, chỉnh sau khi đo tải thật]**
- Hardening: `NoNewPrivileges=yes`, `ProtectSystem=strict`, `ReadWritePaths=/var/lib/cryptosignal`, `PrivateTmp=yes`, `ProtectHome=yes`.

**Unit `omniroute.service`:**
- `ExecStart=/usr/bin/omniroute serve --headless --no-open --no-tray --port 20128`
- `Environment=OMNIROUTE_SERVER_HOST=127.0.0.1 OMNIROUTE_MEMORY_MB=512 DATA_DIR=/var/lib/omniroute`
- Secret đặt trong `EnvironmentFile`, gồm `OMNIROUTE_WS_BRIDGE_SECRET`, bắt buộc ở production theo Docker guide.
- `MemoryMax=900M`.
- Lưu ý:
  - **Không dùng `HOSTNAME`** để bind. `.env.example` của OmniRoute ghi rõ biến này bị shell ghi đè; phải dùng `OMNIROUTE_SERVER_HOST`.
  - `omniroute autostart enable` tạo *user service* cộng linger. Trên VPS nên viết system unit thay vì dùng lệnh này.
  - Node ≥ 22.22.2 (hoặc 24). Cài từ NodeSource hoặc tarball chính thức.

**Python:** dùng `uv` hoặc `python3.12 -m venv`, cài từ lockfile. Box có `apps/copilot/uv.lock` chưa được track; cần chốt có commit lockfile hay không.

---

## 3. Web: Next standalone hay static export

| | Standalone (hiện tại) | **Static export (đề xuất)** |
|---|---|---|
| RAM khi chạy | ~**95 MB** RSS rảnh [đo, `node .next/standalone/server.js`] | 0 (Caddy phục vụ file) |
| Dung lượng | `.next/standalone` 60 MB + static 1,3 MB [đo] | `out/` **1,4 MB** [đo] |
| Proxy `/v1/copilot/*` | Route handler Node (`copilot-proxy.ts`) | Caddy `reverse_proxy` |
| Điều kiện | — | Không có route handler đọc request; không dùng rewrites, cookies hay headers động (theo tài liệu Next). Đã kiểm tra: `/` và `/_not-found` đều tĩnh (`○`), chỉ `/v1/copilot/[...path]` là động (`ƒ`). |
| Build | — | Build **không chạy trên VPS**: build Next đo được tổng RSS cây process **~970 MB** với 5 worker [đo]. Build trên CI hoặc Mac rồi rsync `out/`. |

**Kết quả thử:**
- Đổi `output: "export"` và tạm bỏ thư mục `app/v1` ⇒ `next build` thành công, chỉ còn trang tĩnh.
- `next/font/google` được tải lúc build nên không ảnh hưởng.

**Thay đổi đề xuất** (coder làm, chưa làm):
- `next.config.ts`: `output: process.env.NEXT_OUTPUT === "export" ? "export" : "standalone"`. Giữ standalone cho Docker/Vercel.
- Route proxy: phải tách khỏi build export. Có hai cách:
  - (a) xóa route khi build export bằng script `apps/web/scripts/build-export`;
  - (b) chuyển route sang thư mục chỉ dùng cho standalone.
  - Next không có cờ "bỏ qua route" sẵn, nên cách (a) đơn giản nhất **[cần coder xác nhận]**.
- Không đặt `NEXT_PUBLIC_COPILOT_URL` ⇒ client gọi cùng origin (`lib/copilot-api.ts`).

**Caddy** (phác thảo):
- `cryptosignal.example.vn { encode zstd gzip; root * /srv/cryptosignal/web/current; handle /v1/copilot/* { reverse_proxy 127.0.0.1:8000 { flush_interval -1 } } handle { try_files {path} {path}.html /index.html; file_server } }`
- Caddy tự flush `text/event-stream`; `flush_interval -1` đặt cho chắc.
- Header bảo mật (HSTS, `X-Content-Type-Options`), và `Cache-Control: immutable` cho `/_next/static/*`.

---

## 4. Cơ sở dữ liệu: SQLite WAL hay Postgres

| | **SQLite WAL (đề xuất)** | Postgres 16 |
|---|---|---|
| RAM | Trong process, không tốn thêm | Thêm một service; RSS chưa đo trên box **[giả định: vài chục tới >100 MB tùy `shared_buffers`]** |
| Đồng thời | 1 writer cùng nhiều reader. Đủ cho copilot 1 worker và engine autoscan (ghi ít, mỗi job một transaction ngắn) | Nhiều writer |
| Driver | Có sẵn (`sqlite:///`) | `postgresql+psycopg://` (đã hỗ trợ trong `config.py`) |
| Backup | Litestream (stream liên tục) cộng `.backup`/`VACUUM INTO` | `pg_dump` cộng WAL-G/pgBackRest |
| Migration | Alembic (đã có `20251014_0001`, `20251025_0002`). Lưu ý SQLite cần `batch_alter_table` khi ALTER cột. | Alembic như cũ |

**Đề xuất code** (`apps/copilot/src/cryptosignal_copilot/db/engine.py`):
- Thêm listener `connect` cho SQLite: `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000`, `PRAGMA synchronous=NORMAL`, `PRAGMA foreign_keys=ON`.
- Hai process (copilot + autoscan) cùng ghi cần `busy_timeout`. Ghi bằng `BEGIN IMMEDIATE` để tránh lỗi nâng khóa.

**Chuyển sang Postgres khi:**
- cần nhiều hơn 1 worker hoặc nhiều VPS; hoặc
- thấy lỗi "database is locked" thường xuyên dù đã bật WAL.

**Phụ thuộc:** `psycopg[binary]` là dependency bắt buộc dù không dùng Postgres. Đề xuất chuyển sang extra `[postgres]`.

---

## 5. Ngân sách RAM

**Số đo** [đo trên box, Linux x64, Python 3.12, Node 22.22.2; RSS khi rảnh]:

| Thành phần | RSS |
|---|---|
| uvicorn copilot, 1 worker, probe tắt | **169 MB** (PSS 154) |
| … sau khi nạp `exchangeInfo` | đỉnh **277 MB**, rồi giảm về **178 MB** |
| `build_candidate_catalog` ×20 (200 nến 1h) | ~10 ms/lần, RAM không đáng kể |
| OmniRoute 3.8.52 `serve` đầy đủ (heap tự chỉnh) | **562 MB** (2 process) |
| OmniRoute `--headless`, heap tự chỉnh | **535 MB** |
| OmniRoute `--headless`, `OMNIROUTE_MEMORY_MB=384`, sau 30 request | **488 → 494 MB** |
| Next standalone `server.js` | **97 MB** (bỏ được nếu dùng export) |
| Caddy 2.11.7 (file_server + reverse_proxy, chưa có TLS) | **49 MB** |

Ghi chú:
- Số đo OmniRoute là với thư mục dữ liệu trống và chưa cấu hình provider. Khi có tải thật có thể cao hơn **[chưa đo]**.
- `.env.example` của OmniRoute tự ghi: native memory (better-sqlite3, buffer) khoảng **~300 MB** ngoài heap.
- Bản cài npm toàn cục của OmniRoute chiếm **2,8 GB đĩa** [đo]. Cần ≥ 25 GB SSD.

| Hạng mục | VPS 1 GB | **VPS 2 GB (đề xuất)** | VPS 4 GB |
|---|---|---|---|
| OS + systemd + journald + sshd **[giả định]** | ~150 MB | ~150 MB | ~150 MB |
| Caddy | ~50 | ~50 | ~50 |
| OmniRoute (`MEMORY_MB`) | ~490 (384) | ~500–600 (512) | ~600–800 (1024) |
| Copilot (đỉnh) | ~280 | ~280 | ~280 |
| Autoscan (cùng import, ~165 MB) | không đủ chỗ; chỉ dùng timer oneshot | ~170 | ~170 |
| Web | 0 (export) | 0 | 0 |
| **Tổng** | **~970 MB + autoscan ⇒ vượt** | **~1,15–1,25 GB** | ~1,3–1,5 GB |
| Swap | 2 GB (bắt buộc, sẽ chậm) | **1–2 GB** swapfile, `vm.swappiness=10` | 1 GB |

⇒ **1 GB chỉ chạy được nếu** OmniRoute tối thiểu, không có autoscan, và chấp nhận swap. Không khuyến nghị. **2 GB** là mức nên dùng. Thêm `zram` là tùy chọn.

---

## 6. Biên mạng: Caddy, nginx+certbot hay Cloudflare Tunnel

| | **Caddy (đề xuất)** | nginx + certbot | Cloudflare Tunnel (`cloudflared`) |
|---|---|---|---|
| TLS | Tự động (ACME), tự gia hạn | certbot cộng timer | Cloudflare lo; VPS không mở 80/443 |
| SSE | Tự flush `text/event-stream` | Cần `proxy_buffering off` (app đã gửi `X-Accel-Buffering: no`) | Proxy Read Timeout **125 s**. App gửi keepalive mỗi 12 s (`app.py`) nên ổn |
| RAM | ~49 MB [đo] | Thấp hơn **[chưa đo]** | `cloudflared` **[chưa đo]** |
| Ghi chú | 1 binary, cấu hình ngắn | Quen thuộc | Ẩn IP gốc, chống DDoS cơ bản. Thêm phụ thuộc vào Cloudflare. IP client phải lấy từ `CF-Connecting-IP`. |

**Lưu ý rate limit:**
- `rate_limit.py` lấy IP từ `X-Forwarded-For`. Uvicorn phải chỉ tin proxy `127.0.0.1` (`--forwarded-allow-ips 127.0.0.1`), và không được mở cổng 8000 ra ngoài.
- Nếu dùng Cloudflare, Caddy phải ghi đè `X-Forwarded-For` bằng `CF-Connecting-IP`. Nếu không, mọi người dùng sẽ chung một IP và cùng bị giới hạn **[cần coder kiểm tra cách `rate_limit.py` chọn hop]**.

---

## 7. Firewall và SSH
- `ufw default deny incoming`. Chỉ mở `22/tcp` (hoặc cổng SSH tùy chọn) và `80,443/tcp` (bỏ nếu dùng Tunnel).
- **Không mở 8000 hay 20128.** Kiểm tra bằng `ss -ltnp`: chỉ Caddy và sshd được nghe trên `0.0.0.0`.
- SSH:
  - `PasswordAuthentication no`, `PermitRootLogin no`, `KbdInteractiveAuthentication no`.
  - Chỉ dùng key ed25519, `AllowUsers deploy`.
  - Cài `fail2ban` hoặc `sshguard`.
- `unattended-upgrades` cho bản vá bảo mật. Bật đồng bộ thời gian (`systemd-timesyncd`), quan trọng cho việc tính giờ đóng nến.
- Dashboard OmniRoute (nếu không dùng `--headless`): chỉ truy cập qua SSH tunnel `ssh -L 20128:127.0.0.1:20128`.

---

## 8. Backup, log và giám sát

**Backup:**
- **Litestream v0.5.17** (31/8/2026): stream WAL của `sessions.sqlite3` lên S3-compatible (Cloudflare R2, Backblaze B2, DO Spaces).
- Cộng thêm `sqlite3 sessions.sqlite3 ".backup /var/backups/cs-$(date +%F).sqlite3"` hằng ngày bằng systemd timer, giữ 14 bản, đẩy offsite bằng `rclone`.
- Dữ liệu OmniRoute (`/var/lib/omniroute/storage.sqlite`, có cấu hình provider và key đã mã hóa) dùng cùng timer. Bản backup phải **mã hóa** (`age` hoặc `rclone crypt`) vì có chứa credential.
- Snapshot của nhà cung cấp (+20% giá trên Vultr; DO +20%/tuần hoặc +30%/ngày) là tùy chọn.
- **Diễn tập khôi phục** mỗi tháng (`litestream restore`).

**journald:**
- `/etc/systemd/journald.conf.d/size.conf`: `SystemMaxUse=200M`, `SystemMaxFileSize=20M`, `MaxRetentionSec=14day`.
- Log của app không được in prompt, key hay token.

**Giám sát:**
- Uptime ngoài (UptimeRobot hoặc Better Stack, free tier) gọi `GET /v1/copilot/health` và `/`.
- `systemd` `OnFailure=` gửi cảnh báo Telegram cho admin qua một script nhỏ dùng bot admin riêng.
- Theo dõi RAM và swap bằng `node_exporter` (nhẹ) hoặc chỉ dùng `systemd-cgtop` và cảnh báo khi `MemoryHigh` bị chạm.
- Có health check riêng cho Binance: kiểm tra `data-api.binance.vision` mỗi 5 phút, cảnh báo khi gặp 451/403.

---

## 9. Đặt engine tự động ở đâu

| | Trong process uvicorn | **Service riêng (đề xuất)** | systemd timer oneshot |
|---|---|---|---|
| RAM | +0 | +~170 MB | +~165 MB chỉ khi chạy (~vài chục giây mỗi giờ) |
| Cô lập lỗi | Kém | Tốt | Tốt |
| Tranh chấp | Chung event loop với SSE người dùng; tải `exchangeInfo`/klines chặn loop (urllib đồng bộ trong `symbol_tick.py`) | Tách CPU (`Nice=10`, `CPUWeight=50`) | Như service riêng |
| Retry gửi tin | — | Liên tục | Cần timer thứ hai |

**Tranh chấp tài nguyên:**
1. **OmniRoute:** engine dùng semaphore LLM = 1, timeout 60 s. Giờ cao điểm có thể tạm hoãn LLM (`AUTOSCAN_LLM_MODE=off` theo khung giờ).
2. **SQLite:** WAL cộng `busy_timeout` cộng transaction ngắn.
3. **Binance:** chung IP outbound. Engine giới hạn ≤ 5 request/giây và dùng jitter.
4. **CPU:** detector chỉ ~10 ms/lần, không đáng kể. Phần nặng là import Python lúc khởi động và LLM (chạy ở xa).

---

## 10. Đề xuất thay đổi code (coder làm sau khi anh duyệt)

| # | File | Thay đổi | Lợi ích |
|---|---|---|---|
| 1 | `apps/copilot/src/cryptosignal_copilot/db/engine.py` | PRAGMA WAL, `busy_timeout`, `synchronous=NORMAL` qua event `connect` (chỉ với SQLite) | An toàn khi 2 process cùng ghi |
| 2 | `apps/copilot/src/cryptosignal_copilot/config.py` | Khi chạy production (`COPILOT_ENV=production`) mà không có `DATABASE_URL`/`COPILOT_DATA_DIR`, báo lỗi thay vì rơi về `/tmp` | Tránh mất dữ liệu khi reboot |
| 3 | `apps/copilot/src/cryptosignal_copilot/symbol_tick.py` | Gọi `exchangeInfo?symbol=XYZ` theo từng symbol (Binance hỗ trợ tham số `symbol`), cache theo symbol, có TTL, cache ra đĩa. Dùng `httpx` async thay vì urllib đồng bộ. | Bớt ~100 MB đỉnh RSS và 2,5 s chặn event loop |
| 4 | `apps/copilot/pyproject.toml` | `pydantic-ai` → `pydantic-ai-slim[openai]` (OmniRoute nói giao thức OpenAI-compatible); `psycopg[binary]` → extra `[postgres]` | venv **243 → 110 MB** đĩa, RSS import 106 → 99 MB [đo]. Cần chạy lại test để chắc không dùng provider khác. |
| 5 | `apps/web/next.config.ts` + script build export | `NEXT_OUTPUT=export`; loại `app/v1/copilot/[...path]` khỏi build export | Bỏ process Node |
| 6 | `apps/copilot/src/cryptosignal_copilot/app.py` | Xác minh và ghi tài liệu về drain loop toàn cục (`latest_request`). Nếu nó là toàn cục theo process thì người dùng A có thể bị "superseded" bởi người dùng B. Cân nhắc gắn theo session/client. | Đúng đắn khi có nhiều người dùng |
| 7 | `apps/copilot/src/cryptosignal_copilot/rate_limit.py` | Chọn IP client theo cấu hình proxy tin cậy (`TRUSTED_PROXY_HOPS`) | Chống giả mạo `X-Forwarded-For` hoặc dùng chung IP |
| 8 | `deploy/vps/` (mới) | `Caddyfile`, các unit systemd, `journald.conf.d`, `litestream.yml` (không chứa secret), `deploy.sh` | Tái lập được |
| 9 | `.github/workflows/` | Job build `out/` và wheel/venv, upload artifact. Deploy **chỉ thủ công** (không tự push lên VPS khi chưa duyệt). | Build không chạy trên VPS |

---

## 11. Nhà cung cấp VPS, độ trễ và khả năng truy cập Binance

| Nhà cung cấp | Gói phù hợp | Giá (tháng 10/2026) | Vị trí gần VN |
|---|---|---|---|
| **DigitalOcean** | 2 GiB / 1 vCPU · **2 GiB / 2 vCPU** · 4 GiB / 2 vCPU | **$12** · **$18** · $24 (1 GiB/1 vCPU: $6). Backup +20%/tuần hoặc +30%/ngày. Tính tiền theo giây từ 1/1/2026. | Singapore (SGP1) |
| **Vultr** | Regular 1 vCPU/2 GB · **Regular 2 vCPU/2 GB** · High Perf 2/4 GB | **$10** · **$15** · $24 (Regular 1/1 GB: $5; High Perf 1/2 GB: $12, 2/2 GB: $18). Backup +20%. Giá có thể khác theo vùng. | Singapore |
| **BizFly Cloud** (VN) | 1/2 GB · **2/2 GB** · 2/4 GB | 120.000đ · **170.000đ** · 240.000đ /tháng (chưa VAT, 100 Mbps) | Hà Nội / TP.HCM |
| Hetzner Cloud | Cost-Optimized / Regular | Từ €5,99 / €6,49 (chưa VAT) tại EU. **Giá và tình trạng tại Singapore [chưa xác minh]**: trang ghi một số gói "currently not available". | Singapore |

**Độ trễ tới VN:**
- SG → HN/HCM thường vài chục ms; VN nội địa thấp hơn **[chưa đo; nên đo bằng `mtr` sau khi tạo máy thử]**.
- Với ứng dụng này, độ trễ LLM (giây) lớn hơn nhiều so với độ trễ mạng.

**Truy cập Binance:**
- Server chỉ dùng `data-api.binance.vision`, endpoint REST công khai chỉ cho market data, cộng `wss://data-stream.binance.vision`.
- Trình duyệt người dùng vẫn gọi `api.binance.com` (`apps/web/lib/binance.ts`), và điều này không phụ thuộc VPS.
- **Tránh region Mỹ**: Render Oregon từng gặp 451.
- Sau khi tạo VPS: `curl -sI https://data-api.binance.vision/api/v3/ping` phải trả 200 **trước khi** chốt nhà cung cấp.

**Gợi ý:**
- **DigitalOcean SG 2 GiB/2 vCPU ($18)** hoặc **Vultr SG Regular 2/2 ($15)**: hạ tầng quốc tế, ít rủi ro chặn từ phía Binance.
- **BizFly 2/2 (170.000đ)**: rẻ, gần người dùng. Cần kiểm tra Binance và tuyến quốc tế tới agentrouter.

---

## 12. OmniRoute trên VPS: điểm cần lưu ý
- Cài bằng `npm install -g omniroute` (Node ≥ 22.22.2). Bản 3.8.52 trên npm chiếm 2,8 GB đĩa [đo].
- Cổng 20128, API `/v1`. Redis là tùy chọn: không đặt `REDIS_URL` thì dùng limiter in-memory.
- Hướng dẫn VM chính thức: tối thiểu 1 vCPU / 1 GB, khuyến nghị 2 vCPU / 2 GB. Số đo của mình xác nhận 1 GB là quá chật.
- `OMNIROUTE_MEMORY_MB`: `.env.example` gợi ý 512 cho 1 GB và **1024 cho 2 GB**. Đề xuất **512** trên VPS 2 GB để chừa chỗ cho copilot và autoscan.
- **Bảo mật:** `REQUIRE_API_KEY` mặc định là false. Phải bật API key **và** bind loopback. Copilot gọi OmniRoute bằng key riêng, đặt trong `copilot.env`, không commit.
- **Provider:**
  - `agentrouter/deepseek-v4-flash` là API key HTTP, chạy được trên VPS. Phải tuân thủ tài liệu agentrouter (https://agentrouter.org/docs/index.html) theo yêu cầu trước đây của anh.
  - `cursor/*` (`cursor/auto*`, `composer-2.5` trong allowlist ở `docs/OMNIROUTE_CONFIG.md`) chạy qua `cursor-agent` CLI cần đăng nhập. Mỗi lần lỗi có thể mất ~18 s mới trả 502. → Đề xuất **bỏ khỏi allowlist trên VPS**.
- Chuyển cấu hình từ Mac (`~/.omniroute/storage.sqlite`): **không copy trực tiếp** vì có credential. Nên cấu hình lại trên VPS qua SSH tunnel vào dashboard, hoặc qua CLI.

---

## 13. Quy trình deploy và runbook

### 13.1 Lần đầu
1. Tạo VPS (Ubuntu 24.04 LTS). Kiểm tra Binance (`curl … /api/v3/ping`) và agentrouter.
2. Tạo user `deploy` (chỉ dùng key). Hardening SSH, ufw, unattended-upgrades, swapfile 2 GB, journald limits.
3. Cài Python 3.12, `uv`, Node 22.22.x, Caddy (repo chính thức), Litestream 0.5.17, `sqlite3`, `rclone`.
4. Tạo user `cryptosignal` và `omniroute`, các thư mục `/srv`, `/var/lib`, `/etc` như §2.
5. Cài OmniRoute, viết `omniroute.service`, cấu hình provider agentrouter qua SSH tunnel, bật API key.
6. Deploy copilot: tạo venv từ artifact CI, `copilot.env`, `systemctl enable --now cryptosignal-copilot`. Migration tự chạy.
7. Deploy web: rsync `out/` vào `/srv/cryptosignal/web/releases/<sha>`, trỏ `current`.
8. Cấu hình Caddy, trỏ DNS, kiểm tra HTTPS và SSE (`curl -N`).
9. Bật `litestream.service` và timer backup. Thử khôi phục.
10. Bật uptime monitor. Chỉ sau khi chạy ổn 1 tuần mới bàn chuyện bỏ Render/Vercel, và phải có OK của anh.

### 13.2 Mỗi lần cập nhật
1. CI build artifact.
2. `deploy.sh <sha>`: rsync sang `releases/<sha>`, `alembic upgrade head` (hoặc để service tự chạy), đổi symlink `current`, `systemctl restart cryptosignal-copilot`. Web chỉ cần đổi symlink.
3. Health check. Lỗi thì đổi symlink về bản trước và restart. Migration phải tương thích ngược ít nhất 1 phiên bản để rollback được.

### 13.3 Sự cố thường gặp

| Triệu chứng | Kiểm tra | Xử lý |
|---|---|---|
| 502 từ Caddy | `systemctl status cryptosignal-copilot`, `journalctl -u … -n 100` | Restart; xem OOM (`journalctl -k \| grep -i oom`) |
| LLM lỗi hoặc chậm | `journalctl -u omniroute`, `curl 127.0.0.1:20128/v1/models` (có key) | Restart OmniRoute; kiểm tra quota agentrouter |
| Binance 451/403 | `curl -sI https://data-api.binance.vision/api/v3/ping` | Đổi IP hoặc vùng (cần OK của anh) |
| "database is locked" | Tiến trình nào giữ transaction lâu | Kiểm tra `busy_timeout`; cân nhắc Postgres |
| Hết RAM, swap cao | `systemd-cgtop`, `free -m` | Hạ `OMNIROUTE_MEMORY_MB`, tắt autoscan, nâng gói |
| Đĩa đầy | `du -sh /var/lib/* /var/log/journal` | `journalctl --vacuum-size=100M`; dọn `releases/` cũ |

---

## 14. Câu hỏi mở
1. Ngân sách tháng: $15–18 (SG) hay ~170.000đ (BizFly)? Có chấp nhận lên 4 GB (~$24) để thoải mái không?
2. Tên miền và DNS: có dùng Cloudflare không? Dùng Tunnel hay mở 443 trực tiếp?
3. Có giữ provider `cursor/*` trên VPS không? (Đề xuất: không.)
4. Nơi lưu backup offsite: R2, B2 hay Spaces?
5. Có cho phép coder làm các thay đổi code ở §10 (nhất là #3, #4, #6) trước khi deploy không?
6. Khi nào ngừng Render/Vercel? (Chưa đổi gì cho đến khi anh OK.)
7. Có commit `apps/copilot/uv.lock` để cài đặt tái lập được không?

---

## Quyết định cần anh chốt
1. **Kích thước VPS:** *Đề xuất:* **2 vCPU / 2 GB** (DO SG $18 hoặc Vultr SG $15), swap 2 GB. Không dùng 1 GB vì OmniRoute rảnh đã ~490–560 MB [đo].
2. **Web:** *Đề xuất:* **Next static export** cộng Caddy phục vụ file và proxy `/v1/copilot/*`. Build trên CI vì build cần ~1 GB RAM. Bỏ process Node (~95 MB).
3. **DB:** *Đề xuất:* **SQLite WAL** cộng Litestream lên S3-compatible và `.backup` hằng ngày. Đặt `COPILOT_DATA_DIR` cố định. Postgres chỉ khi cần nhiều worker.
4. **Biên và TLS:** *Đề xuất:* **Caddy** mở 443 cộng ufw. Cloudflare Tunnel là phương án thay thế nếu muốn ẩn IP (khi đó phải sửa cách lấy IP cho rate limit).
5. **OmniRoute:** *Đề xuất:* system service `--headless`, `OMNIROUTE_SERVER_HOST=127.0.0.1`, `OMNIROUTE_MEMORY_MB=512`, bật API key. **Chỉ dùng provider agentrouter**, bỏ `cursor/*`.
6. **Engine tự động:** *Đề xuất:* service systemd **riêng** (`Nice=10`, `MemoryMax`), dùng chung SQLite WAL, semaphore LLM = 1. Không chạy trong uvicorn.
7. **Làm gọn code trước khi deploy:** *Đề xuất:* duyệt các mục §10 #1–#4 (WAL, không rơi về `/tmp`, sửa `exchangeInfo`, `pydantic-ai-slim` và bỏ psycopg khỏi core) và #6 (drain loop). #5 làm cùng lúc chuyển sang static export.
8. **Nhà cung cấp và vị trí:** *Đề xuất:* Singapore (DO/Vultr). Chạy thử 1 ngày để kiểm tra Binance `data-api`, agentrouter và độ trễ trước khi chốt. BizFly là phương án tiết kiệm nếu kiểm tra đạt.

---

## Nguồn tham khảo
(Truy cập tháng 10/2026)

**Repo**
- `DEPLOY.md`, `render.yaml`, `deploy/DEPLOY.md`, `deploy/docker-compose.yml`, `deploy/cloudrun/deploy.sh`
- `apps/copilot/{DEPLOY.md, Dockerfile, pyproject.toml, config/omniroute.env.example}`
- `apps/copilot/src/cryptosignal_copilot/{app.py, config.py, db/engine.py, db/models.py, rate_limit.py, symbol_tick.py, klines.py}`
- `apps/web/{next.config.ts, package.json, app/page.tsx, app/layout.tsx, app/v1/copilot/[...path]/route.ts, lib/server/copilot-proxy.ts, lib/copilot-api.ts, .env.example, Dockerfile}`
- `.github/workflows/web.yml`
- `docs/OMNIROUTE_CONFIG.md`, `docs/MODEL_SELECTION_SPEC.md`

**OmniRoute**
- README, `docs/guides/SETUP_GUIDE.md`, `DOCKER_GUIDE.md`, `skills/cli-serve/SKILL.md`, `.env.example`: https://github.com/diegosouzapw/OmniRoute ; https://omniroute.online
- SELF_HOST_GUIDE (bản trên jsdelivr).
- VM deployment guide: chỉ có snippet từ kết quả tìm kiếm; link trực tiếp trả 404.
- `omniroute serve --help` và `.env.example` của bản npm 3.8.52 (đọc trên box).

**Next.js, Caddy, Cloudflare, Litestream, SQLite, Binance**
- Next.js Static Exports: https://nextjs.org/docs/app/guides/static-exports
- Caddy `reverse_proxy` (flush SSE, `flush_interval`): https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Cloudflare connection limits (Proxy Read Timeout 125 s): https://developers.cloudflare.com/fundamentals/reference/connection-limits/
- Litestream: https://litestream.io ; releases: https://github.com/benbjohnson/litestream/releases (v0.5.17, 31/8/2026)
- SQLite WAL: https://www.sqlite.org/wal.html ; `VACUUM INTO`: https://www.sqlite.org/lang_vacuum.html
- Binance market-data-only: https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md
- systemd `journald.conf`: https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html

**Giá VPS**
- DigitalOcean Droplets: https://www.digitalocean.com/pricing/droplets
- Vultr: https://www.vultr.com/pricing/
- Hetzner Cloud: https://www.hetzner.com/cloud
- BizFly Cloud VPS: https://bizflycloud.vn/cloud-vps

**Chưa xác minh**
- Giá Hetzner tại Singapore.
- RSS của OmniRoute khi có tải thật, và RSS của `cloudflared`, nginx, Postgres.
- Độ trễ SG/VN.
- Cách `rate_limit.py` chọn hop trong `X-Forwarded-For`.
- Phạm vi của drain loop trong `app.py`.
