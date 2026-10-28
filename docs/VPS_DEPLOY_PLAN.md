# VPS_DEPLOY_PLAN: một VPS 1 GB tự host (không Docker), OmniRoute slim là provider model duy nhất

> **Trạng thái:** bản 2, cập nhật 28/10/2026 (ICT, UTC+7). Thay thế bản nháp 26/10/2026 (commit `94686397`).
> **Quyết định chính (anh đã duyệt 28/10):**
> - VPS: **Vultr `vc2-1c-1gb` tại Singapore (`sgp`)**, giá $5/tháng.
> - OS: Debian 13 hoặc Ubuntu 24.04 đã cắt gọn.
> - Thành phần: nginx phục vụ bản build tĩnh, uvicorn (copilot) và OmniRoute chạy chế độ slim.
>
> Bản này vẫn thay thế kế hoạch Cloud Run + Turso đang tạm dừng (`deploy/cloudrun/deploy.sh`, `apps/copilot/DEPLOY.md`). Bản này không đổi region Render (`render.yaml`).
>
> **Ký hiệu số liệu:**
> - **[đo thực tế: nơi đo]**: số tự đo, có ghi nơi đo.
> - **[ước tính]**: chưa đo, hoặc suy ra.
> - **[nguồn: ...]**: số lấy từ tài liệu hoặc API công khai, đã kiểm tra ngày 28/10/2026.
> - **[cấu hình]**: giá trị cài đặt, không phải số đo.
>
> **Dữ liệu đo:**
> - `/workspace/vps/REPORT_vultr_1gb.md` (nghiên cứu 27/10)
> - `/workspace/omb/*.out` (benchmark OmniRoute, LLM giả lập)
> - `/workspace/vps/run/bench.out` (benchmark copilot)
>
> Tất cả các file trên nằm trên box Linux x64. Các phép đo dùng Python 3.13, Node 22, LLM giả lập, 200 nến BTC 1h. **Chưa đo trên VPS Vultr thật.**

---

## 0. Thay đổi so với bản 26/10 (và lý do)

| Chủ đề | Bản 26/10 | Bản này (28/10) | Vì sao đổi |
|---|---|---|---|
| Kích thước VPS | "2 vCPU / 2 GB là tối thiểu, 1 GB không đủ" | **1 vCPU / 1 GB đủ dùng**, với điều kiện chạy OmniRoute slim, bật zram và đặt giới hạn systemd | Bản cũ đo OmniRoute qua lệnh `omniroute serve` (CLI). Lệnh này sinh **2 process**, trong đó process giám sát (supervisor) chiếm riêng ~100 MB [đo thực tế: `/workspace/omb/A.out`, `M.out`, `C512.out`, cột `per`]. Tổng là ~490-560 MB khi rảnh. Chế độ slim chạy thẳng `node server-ws.mjs` (1 process) với `--max-semi-space-size=2` và tắt dịch vụ nền. Khi đó còn **343-393 MB rảnh, 450-490 MB đỉnh** [đo thực tế: `/workspace/omb/E.out`, `I.out`, `J.out`, `L.out`]. |
| Proxy biên | Caddy (~49 MB) | **nginx 1.26** (4-5 MB) | nginx nhẹ hơn ~40 MB [đo thực tế: REPORT]. TLS do Cloudflare đảm nhận, nên không cần ACME tự động của Caddy. |
| TLS | Caddy tự cấp chứng chỉ, hoặc Cloudflare Tunnel | **Cloudflare proxy + Cloudflare Origin CA certificate**, chế độ Full (strict) | Không cần certbot hay ACME trên máy. Không chạy thêm process `cloudflared`. |
| Engine phân tích tự động | Service systemd riêng | **Chạy trong process copilot** (anh duyệt 28/10) | Tiết kiệm một interpreter Python (~150 MB [đo thực tế: `bench.out`, slim idle 154 MB]), vì 1 GB không đủ chỗ cho hai process Python. |
| Copilot | `pydantic-ai` bản đầy đủ, 169-277 MB | **`pydantic-ai-slim[openai]`**, lazy import Anthropic, **154 MB rảnh, 164-204 MB đỉnh** | Đo lại trên Python 3.13 [đo thực tế: `/workspace/vps/run/bench.out`]. venv giảm 201 → 109 MB. |
| `exchangeInfo` | Tải toàn bộ ~17,8 MB đồng bộ, +114 MB đỉnh | **Đã được coder sửa:** tải async theo từng symbol (`exchangeInfo?symbol=X`) và cache ra đĩa (`symbol_tick.py` tại `97369f58`) | Đỉnh +114 MB không còn áp dụng. |
| Cổng uvicorn | 8000 | **8787** | Theo REPORT |
| Phương án 2 GB | Là khuyến nghị chính | **Bỏ**, không giữ làm dự phòng | REPORT không đề cập gói 2 GB. Phương án nâng cấp mà REPORT nêu là `vhp-1c-1gb` ($6, CPU nhanh hơn, vẫn 1 GB). |
| Litestream | Đề xuất chạy liên tục | **Chuyển thành câu hỏi mở.** Mặc định dùng `sqlite3 .backup` theo timer (không có process thường trú) | RAM của Litestream chưa được đo. Trên 1 GB, mỗi MB đều phải tính. |

---

## 1. Hiện trạng repo liên quan (tại `97369f58`)

| File | Hiện trạng | Việc cần làm |
|---|---|---|
| `apps/copilot/pyproject.toml` | `pydantic-ai>=2.55,<3` (bản đầy đủ), `psycopg[binary]` bắt buộc | Mục 9, thay đổi #1 và #8 |
| `apps/copilot/src/cryptosignal_copilot/model_factory.py` | Import `anthropic`, `AnthropicModel`, `AnthropicProvider` ngay ở đầu file | Thay đổi #2 (lazy import, tiết kiệm ~22 MB [đo thực tế: REPORT]) |
| `apps/web/next.config.ts` | `output: "standalone"` | Thay đổi #3 |
| `apps/web/app/v1/copilot/[...path]/route.ts` | Proxy Node, route động duy nhất | Loại khỏi bản build export (#3) |
| `apps/copilot/src/cryptosignal_copilot/db/engine.py` | Chưa bật WAL | Thay đổi #4 |
| `apps/copilot/src/cryptosignal_copilot/app.py` | Có `CORSMiddleware` đọc `CORS_ORIGINS` / `COPILOT_CORS_ORIGINS`; drain loop toàn cục | #5, #6, #10 |
| `apps/copilot/src/cryptosignal_copilot/symbol_tick.py` | Đã dùng `httpx` async, `exchangeInfo?symbol=X`, cache ra đĩa | Xong, chỉ cần kiểm tra lại trên VPS |
| `apps/copilot/src/cryptosignal_copilot/config.py` | Không có cấu hình DB thì rơi về `/tmp` | #7 |
| `apps/copilot/src/cryptosignal_copilot/rate_limit.py` | IP lấy từ `X-Forwarded-For` | #11 (Cloudflare → nginx → uvicorn) |

---

## 2. Kiến trúc trên VPS

```
Trình duyệt ──HTTPS──► Cloudflare (proxy, cam) ──HTTPS (Origin CA)──► nginx :443 (:80 chỉ để redirect)
                                                                     ├─ /             → /srv/cryptosignal/web/current/ (Next export `out/`)
                                                                     └─ /v1/copilot/  → 127.0.0.1:8787 (proxy_buffering off, SSE)
127.0.0.1:8787  ◄─ cryptosignal-copilot.service  (uvicorn --workers 1; scheduler auto-analysis chạy trong process này)
127.0.0.1:20128 ◄─ omniroute.service             (node server-ws.mjs, headless, slim)
                   cryptosignal-backup.timer     (sqlite3 .backup + rclone, oneshot)
```

- **Firewall:** chỉ mở 22, 80, 443. Cổng 8787 và 20128 chỉ nghe trên `127.0.0.1`.
- **Copilot:** gọi OmniRoute tại `http://127.0.0.1:20128/v1`, bằng API key riêng đặt trong file env (không commit).
- **Trình duyệt:** vẫn lấy nến trực tiếp từ `api.binance.com` (`apps/web/lib/binance.ts`). Server chỉ dùng `data-api.binance.vision`.
- **IPv6-only không áp dụng.** Gói `vc2-1c-0.5gb-v6` chỉ có ở Mỹ. Binance, agentrouter và GitHub đều không có bản ghi AAAA [nguồn: REPORT], nên máy IPv6-only sẽ cần NAT64 hoặc WARP.

---

## 3. Ngân sách RAM cho VPS 1 GB

### 3.1 Theo thành phần

| Thành phần | Rảnh | Đỉnh | Nơi đo |
|---|---|---|---|
| OS Debian 13 (đã cắt gọn) | 70-90 MB [ước tính] | | REPORT |
| OS Ubuntu 24.04 (đã cắt gọn) | 120-150 MB [ước tính] | | REPORT |
| OmniRoute slim (`server-ws.mjs`, headless, heap 512, semi-space 2) | 343-393 MB [đo thực tế: `/workspace/omb/E.out` 343, `I.out` 380, `J.out` 373, `L.out` 393] | 450-490 MB [đo thực tế: `E.out` 462, `J.out` 460, `L.out` 494 sau 600 request] | LLM giả lập, 250-600 request |
| OmniRoute qua CLI `omniroute serve` (để so sánh) | 465-543 MB [đo thực tế: `C512.out`, `B.out`] | 612-653 MB [đo thực tế: `C512.out`, `A.out`] | Có thêm process supervisor ~100 MB |
| Copilot, `pydantic-ai-slim` | 154 MB [đo thực tế: `/workspace/vps/run/bench.out`] | 164-204 MB [đo thực tế: `bench.out` 164; REPORT 204] | 200 nến, LLM giả lập |
| Copilot, `pydantic-ai` đầy đủ (hiện tại) | 181 MB [đo thực tế: `bench.out`] | 225 MB [đo thực tế: `bench.out`] | |
| Scheduler auto-analysis trong copilot | +10-30 MB [ước tính] | | Detector tốn ~10 ms/lần, RAM không đáng kể [đo thực tế: phiên 26/10, `build_candidate_catalog` ×20] |
| nginx 1.26 (static + gzip) | 4 MB [đo thực tế: REPORT] | 5 MB [đo thực tế: REPORT] | |
| journald, sshd, cron, unattended-upgrades | 20-40 MB [ước tính] | | |

Không dùng:
- Next standalone (97 MB [đo thực tế: phiên 26/10]).
- Caddy (42-51 MB [đo thực tế: REPORT]).

### 3.2 Tổng

| Trạng thái | Debian 13 | Ubuntu 24.04 cắt gọn |
|---|---|---|
| Thường ngày | **~660 MB** [ước tính: REPORT] | ~710-720 MB [ước tính] |
| Đỉnh | **~870 MB** [ước tính: REPORT] | ~920 MB [ước tính] |
| RAM dùng được (1024 MB trừ phần kernel giữ lại) | ~950-980 MB [ước tính] | như bên trái |

⇒ Lúc đỉnh chỉ còn dư khoảng 80-100 MB [ước tính]. **Bắt buộc bật zram** (mục 5). Debian 13 dư nhiều hơn Ubuntu khoảng 50 MB [ước tính].

### 3.3 Thử nghiệm không có lợi (đã đo, không dùng)
- **Heap OmniRoute 256 MB ⇒ OOM** [đo thực tế: REPORT].
- Heap 384 MB không bớt RSS so với 512 MB (`I.out` 455 MB, `E.out` 455 MB sau tải [đo thực tế]).
- `jemalloc` / `MALLOC_ARENA_MAX` trên copilot: không giảm, `jemalloc` còn tăng lên 159/171 MB [đo thực tế: `bench.out`].

### 3.4 Rủi ro đã biết
OmniRoute có lỗi rò rỉ bộ nhớ chưa được sửa:
- Issue #17283: "Memory leak: unbounded pending-request retention causes RSS growth".
- Issue #17284: giới hạn số pending request.
- PR sửa lỗi #17282 vẫn **open, chưa merge** [nguồn: GitHub API, kiểm tra 28/10/2026; repo đã chuyển sang `cheaper-inference/OmniRoute`].

Giảm thiểu:
- `MAX_PENDING_REQUEST_AGE_MS=600000` [cấu hình].
- `RuntimeMaxSec=1d` (khởi động lại hằng ngày).
- `MemoryMax` cộng `Restart=always`.

---

## 4. Giới hạn systemd

| Unit | MemoryHigh | MemoryMax | OOMScoreAdjust | Nice | Khác |
|---|---|---|---|---|---|
| `omniroute.service` | **450M** [cấu hình: REPORT] | **560M** [cấu hình: REPORT] | **300** (bị kill trước) | 5 [cấu hình, đề xuất mới, chưa có trong nguồn] | `Restart=always`, `RestartSec=5`, `RuntimeMaxSec=1d`, `Type=notify`, `WatchdogSec=180` |
| `cryptosignal-copilot.service` | **230M** [cấu hình: REPORT] | **300M** [cấu hình: REPORT] | **0** | 0 | `uvicorn --workers 1`, không `--reload`, `--no-access-log`, `Restart=on-failure` |
| `nginx.service` (drop-in) | | | **-500** | | `worker_processes 1` |
| `cryptosignal-backup.service` (oneshot) | | 150M [cấu hình, đề xuất] | 500 | 10 | `IOSchedulingClass=idle` |

**Mâu thuẫn trong nguồn cần anh chốt:**
- Bản nháp `/workspace/vps/omniroute.service` ghi `MemoryHigh=850M`, `MemoryMax=1G`, không có `OOMScoreAdjust` và không có `RuntimeMaxSec`. Trong khi đó, phần tóm tắt của REPORT ghi 450M / 560M / 300 / 1d.
- Trên máy 1 GB, `MemoryMax=1G` không có tác dụng bảo vệ. Vì vậy file mẫu `docs/deploy/omniroute.service` dùng **giá trị của REPORT**.
- `OMNIROUTE_RSS_PRESSURE_MB=800` trong nguồn **cao hơn** `MemoryMax=560M`. Như vậy cơ chế tự khởi động lại của OmniRoute sẽ không bao giờ kích hoạt trước khi cgroup kill process. File mẫu hạ xuống **520** [cấu hình, đề xuất; cần thử trên VPS].
- `MemoryHigh=450M` thấp hơn mức đỉnh đo được (450-490 MB). Khi chạm ngưỡng, kernel sẽ thu hồi bộ nhớ và đẩy trang sang zram, nên lúc tải cao có thể chậm hơn [ước tính]. Nếu thấy chậm, nâng lên 480M.
- `Type=notify` với `WatchdogSec=180` cần `server-ws.mjs` gửi được `sd_notify`. Điều này **chưa được kiểm chứng trên VPS**. Nếu unit không lên được trạng thái `active`, chuyển sang `Type=simple` và bỏ `WatchdogSec`.

Hardening chung:
- `NoNewPrivileges=true`, `ProtectSystem=full` (hoặc `strict`), `ProtectHome=true`, `PrivateTmp=true`.
- `ReadWritePaths` chỉ trỏ vào thư mục dữ liệu.
- User hệ thống riêng: `omniroute`, `cryptosignal`.

File mẫu: **`docs/deploy/omniroute.service`** (chỉ dùng tên biến placeholder, không chứa secret).

---

## 5. zram, swap và sysctl

| Thiết lập | Giá trị | Ghi chú |
|---|---|---|
| zram | zstd, **50% RAM** (~512 MB) [cấu hình], `swap-priority=100` | Debian 13: gói `systemd-zram-generator` (mã nguồn `rust-zram-generator` 1.2.1 có trong trixie [nguồn: sources.debian.org]; tên gói nhị phân [chưa xác minh]). Phương án thay thế là `zram-tools` 0.3.7 [nguồn: sources.debian.org]. |
| Swapfile | **1 GB**, priority 10 [cấu hình] | Chỉ dùng khi zram đã đầy |
| `vm.swappiness` | 150 | Kernel ≥ 5.8 cho phép tới 200. Đặt cao để ưu tiên zram. |
| `vm.page-cluster` | 0 | zram không lợi gì khi đọc trước nhiều trang |
| `vm.watermark_scale_factor` | 125 | kswapd thu hồi sớm hơn |
| `net.core.default_qdisc` / `net.ipv4.tcp_congestion_control` | `fq` / `bbr` | |
| journald | `SystemMaxUse=50M`, `RuntimeMaxUse=16M`, `MaxRetentionSec=2week` | |

**Cắt gọn OS** (theo REPORT):
- Gỡ `snapd`, `multipathd`, `ModemManager`, `udisks2`, `packagekit`, `apport`, `fwupd`. Đa số những gói này chỉ có trên Ubuntu.
- Tắt `cloud-init` sau lần boot đầu (`touch /etc/cloud/cloud-init.disabled`).
- **Giữ** `unattended-upgrades`.
- Đĩa dùng ~8/25 GB [ước tính: REPORT], trong đó riêng OmniRoute cài qua npm đã chiếm 2,8 GB [đo thực tế: phiên 26/10].

---

## 6. Web: nginx phục vụ bản static export

- Build trên Mac hoặc CI, **không build trên VPS**: `next build` cần ~970 MB [đo thực tế: phiên 26/10, tổng RSS cây process]. Sau đó rsync `out/` (1,4 MB [đo thực tế: phiên 26/10]) vào `/srv/cryptosignal/web/releases/<sha>`, rồi trỏ symlink `current`.
- Để trống `NEXT_PUBLIC_COPILOT_URL` ⇒ client gọi cùng origin `/v1/copilot/*` (`apps/web/lib/copilot-api.ts`).
- nginx (phác thảo, không phải file hoàn chỉnh):
  - `worker_processes 1;`
  - `gzip on;`
  - `location / { try_files $uri $uri.html /index.html; }`
  - `location /_next/static/ { expires 1y; add_header Cache-Control "public, immutable"; }`
  - `location /v1/copilot/ { proxy_pass http://127.0.0.1:8787; proxy_http_version 1.1; proxy_buffering off; proxy_read_timeout 600s; proxy_set_header X-Forwarded-For $remote_addr; }`
- **IP thật khi đi qua Cloudflare:** dùng `set_real_ip_from <dải IP Cloudflare>` và `real_ip_header CF-Connecting-IP`. Nhờ vậy `$remote_addr` là IP người dùng, và rate limit trong `rate_limit.py` không bị dồn về một IP.
- **TLS:**
  - Chứng chỉ Cloudflare Origin CA. Gói Free cũng dùng được [nguồn: Cloudflare docs], chế độ **Full (strict)**.
  - Chứng chỉ này chỉ được trình duyệt tin khi đi qua proxy Cloudflare (bản ghi phải bật đám mây cam).
  - Cloudflare **không gửi email nhắc hết hạn** cho Origin CA [nguồn: Cloudflare docs]. Phải tự theo dõi ngày hết hạn.
  - Khóa riêng của chứng chỉ đặt ở `/etc/ssl/private/`, quyền `0600`, không commit.
- **SSE qua Cloudflare:** Proxy Read Timeout là 125 s [nguồn: Cloudflare connection limits]. App gửi keepalive mỗi 12 s (`app.py`) nên an toàn.

---

## 7. OmniRoute slim

- Cài: Node 22 LTS (mới nhất là `v22.23.4` [nguồn: nodejs.org/dist/index.json]), rồi `npm i -g omniroute@3.8.52` (bản mới nhất trên npm ngày 28/10 [nguồn: registry.npmjs.org]).
  - Debian 13 chỉ có `nodejs` 20.19.2 [nguồn: sources.debian.org], thấp hơn mức OmniRoute yêu cầu (≥ 22.22.2). Vì vậy phải cài Node từ tarball chính thức hoặc từ NodeSource.
- Chạy thẳng: `node --dns-result-order=ipv4first --max-old-space-size=512 --max-semi-space-size=2 server-ws.mjs`, với `WorkingDirectory=<npm root>/omniroute/dist`.
  - **Không dùng `omniroute serve`**, vì lệnh này thêm process supervisor ~100 MB [đo thực tế: `/workspace/omb/M.out`].
- Biến môi trường chính [cấu hình]:
  - `OMNIROUTE_HEADLESS=1`, `OMNIROUTE_DISABLE_BACKGROUND_SERVICES=true`, `REQUIRE_API_KEY=true`
  - `OMNIROUTE_SERVER_HOST=127.0.0.1`, cổng 20128
  - `OMNIROUTE_MEMORY_MB=512`, `MALLOC_ARENA_MAX=2`
  - `CALL_LOG_RETENTION_DAYS=3`, `CALL_LOG_MAX_ENTRIES=2000`, `MAX_PENDING_REQUEST_AGE_MS=600000`
  - `APP_LOG_TO_FILE=false`, `APP_LOG_LEVEL=warn`
- Biến bí mật nằm trong `/var/lib/omniroute/.env` (quyền `0600`, chủ sở hữu `omniroute`). **Chỉ ghi tên, không ghi giá trị:** `STORAGE_ENCRYPTION_KEY`, `JWT_SECRET`, `API_KEY_SECRET`, `INITIAL_PASSWORD`, và `OMNIROUTE_WS_BRIDGE_SECRET` (bắt buộc ở production theo Docker guide của OmniRoute).
- Rate limit mặc định của OmniRoute cho mỗi API key là **60 req/phút, giãn cách 350 ms** [nguồn: REPORT, Settings > Resilience]. Mức này có thể làm chậm bước probe model của copilot (`model_probe.py` probe lần lượt từng model). Chỉnh trong dashboard nếu cần.
- Mac dùng chung cấu hình slim qua script `docs/deploy/omniroute-slim-mac.sh` (bản sao của `/workspace/vps/omniroute-slim-mac.sh`; script đọc `~/.omniroute/.env`, không chứa secret).
- **Provider:**
  - Chỉ dùng `agentrouter/*` (API key HTTP).
  - Provider `cursor/*` cần `cursor-agent` CLI và phải đăng nhập, nên không đưa lên VPS (giữ khuyến nghị của bản 26/10).
- Dashboard bị tắt ở chế độ headless. Cấu hình provider bằng một trong hai cách:
  - (a) tạm bật dashboard rồi vào qua SSH tunnel `ssh -L 20128:127.0.0.1:20128`;
  - (b) dùng CLI.
  - **Không copy** `storage.sqlite` từ Mac, vì file này chứa credential.

---

## 8. Copilot (uvicorn) và scheduler trong cùng process

- `ExecStart=<venv>/bin/uvicorn cryptosignal_copilot.app:app --host 127.0.0.1 --port 8787 --workers 1 --no-access-log --proxy-headers --forwarded-allow-ips 127.0.0.1`
- Env (chỉ ghi tên):
  - `COPILOT_DATA_DIR=/var/lib/cryptosignal/copilot`, `COPILOT_RUN_DB_MIGRATIONS=1`
  - `CORS_ORIGINS=https://<tên miền thật>`
  - `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL=agentrouter/deepseek-v4-flash`
  - Tất cả đặt trong `/etc/cryptosignal/copilot.env`, quyền `0600`.
- Cài đặt: `uv sync --no-dev`, sau đó `python -m compileall` để tránh biên dịch lúc chạy.
- **Scheduler auto-analysis chạy trong process này** (anh duyệt 28/10). Các ràng buộc:
  1. **Bắt buộc `--workers 1`.** Nhiều worker sẽ làm job chạy trùng.
  2. Scheduler gọi **hàm pipeline trực tiếp**, không gọi HTTP `/v1/copilot/analyze`, để không đụng drain loop "superseded" (`docs/AUTO_ANALYSIS_SPEC.md` §3.3).
  3. Dùng semaphore LLM = 1. Phần CPU đồng bộ (detector) chạy bằng `asyncio.to_thread` để không chặn SSE của người dùng.
  4. Nếu copilot vượt `MemoryMax=300M` thì cả API lẫn scheduler đều khởi động lại. Job phải lưu trong DB và idempotent (spec §10.2).
  5. Phương án dự phòng đã có trong `AUTO_ANALYSIS_SPEC.md` §3.2: systemd timer oneshot. **Không bật** khi chưa có OK của anh.

---

## 9. Danh sách thay đổi code

**Đã duyệt 28/10** (REPORT, mục "Code changes (approved by user Oct 28)"):

| # | File | Thay đổi | Lợi ích |
|---|---|---|---|
| 1 | `apps/copilot/pyproject.toml` | `pydantic-ai` → `pydantic-ai-slim[openai]`; chỉ thêm `[anthropic]` nếu thực sự cần | 181 → 154 MB khi rảnh; venv 201 → 109 MB [đo thực tế: `bench.out`, REPORT] |
| 2 | `apps/copilot/src/cryptosignal_copilot/model_factory.py` | Lazy import `AnthropicModel` / `AnthropicProvider` / `AsyncAnthropic` bên trong nhánh `cfg.style == "anthropic"` | -22 MB [đo thực tế: REPORT] |
| 3 | `apps/web/next.config.ts` + script build | `output: "export"` bật theo env; build export bỏ route `app/v1/copilot/[...path]`; nginx lo phần proxy | Không cần process Node |
| 4 | `apps/copilot/src/cryptosignal_copilot/db/engine.py` | SQLite `PRAGMA journal_mode=WAL`, `synchronous=NORMAL` (cùng `busy_timeout`) qua event `connect` | An toàn khi API và scheduler cùng ghi |
| 5 | `apps/copilot/src/cryptosignal_copilot/app.py` (lifespan) + module mới `autoscan/` | Scheduler auto-analysis chạy trong process copilot | Tiết kiệm một process Python |
| 6 | `app.py`, file env | CORS chỉ cho tên miền thật (`CORS_ORIGINS`), bind `127.0.0.1` | Bảo mật |

**Các mục ở §10 của bản 26/10.** REPORT ghi "plus items in VPS_DEPLOY_PLAN.md section 10" ngay dưới tiêu đề "approved", nên mình hiểu là **đã duyệt**. Anh xác nhận lại giúp, xem phần Quyết định, mục O1:

| # | File | Thay đổi | Trạng thái |
|---|---|---|---|
| 7 | `config.py` | Ở production, thiếu `DATABASE_URL` / `COPILOT_DATA_DIR` thì báo lỗi, không rơi về `/tmp` | Chưa làm |
| 8 | `pyproject.toml` | Chuyển `psycopg[binary]` sang extra `[postgres]` | Chưa làm |
| 9 | `symbol_tick.py` | Tải `exchangeInfo` async theo từng symbol, cache ra đĩa | **Đã xong** ở `97369f58` |
| 10 | `app.py` | Xác minh phạm vi drain loop (`latest_request`). Gắn theo session/client nếu đang toàn cục | Chưa làm. Quan trọng hơn trước vì scheduler nay chạy chung process. |
| 11 | `rate_limit.py` | Chọn IP theo cấu hình proxy tin cậy. Qua Cloudflare + nginx thì lấy `$remote_addr` đã được nginx khôi phục | Chưa làm |
| 12 | `deploy/vps/` (mới) | nginx conf, các unit systemd, `zram-generator.conf`, `sysctl.d`, `journald.conf.d`, `deploy.sh` (không secret) | Chưa làm. Ví dụ `omniroute.service` hiện ở `docs/deploy/`. |
| 13 | `.github/workflows/` | Job build `out/` và artifact; deploy chỉ chạy thủ công | Chưa làm |

---

## 10. Nhà cung cấp và gói

| Gói Vultr | vCPU / RAM / đĩa / băng thông | Giá/tháng | Có ở `sgp`? | Ghi chú |
|---|---|---|---|---|
| **`vc2-1c-1gb`** (đã chọn) | 1 / 1024 MB / 25 GB / 1 TB | **$5** | Có (31 vị trí) | [nguồn: `api.vultr.com/v2/plans`, 28/10/2026] |
| `vhp-1c-1gb-amd` / `-intel` | 1 / 1024 MB / 25 GB NVMe / 2 TB | $6 | Có | CPU nhanh hơn. Là đường nâng cấp theo REPORT. [nguồn: Vultr API] |
| `vc2-1c-0.5gb` | 1 / 512 MB / 10 GB | $3,50 | Không (chỉ `ewr`) | [nguồn: Vultr API] |
| `vc2-1c-0.5gb-v6` | IPv6-only, 512 MB | $2,50 | Không (Mỹ) | [nguồn: Vultr API] |

- Backup tự động của Vultr: +20% [nguồn: REPORT; vultr.com/pricing].
- Image trên Vultr: `Debian 13 x64 (trixie)` (os id 2625) và `Ubuntu 24.04 LTS x64` (os id 2284) [nguồn: `api.vultr.com/v2/os`, 28/10/2026].
- **Debian 13 "trixie"** là bản stable hiện hành: ra mắt 9/8/2025, bản cập nhật mới nhất là **13.7 ngày 12/9/2026** [nguồn: debian.org/releases]. Đi kèm nginx 1.26.3 và Python 3.13.5 [nguồn: sources.debian.org], khớp với Python 3.13 dùng khi đo.
- **Binance:** khả năng truy cập `data-api.binance.vision` từ IP Vultr Singapore **[chưa xác minh]**. Tạo instance tính theo giờ và chạy `curl https://data-api.binance.vision/api/v3/ping` trước khi dùng lâu dài. Tránh region Mỹ (Render Oregon từng gặp 451).

---

## 11. Các bước dựng máy

1. **Tạo server:** Vultr `vc2-1c-1gb`, `sgp`, Debian 13 (hoặc Ubuntu 24.04), thêm SSH key. Firewall chỉ mở 22/80/443. **Kiểm tra ngay:** `curl -sI https://data-api.binance.vision/api/v3/ping` phải trả 200, và agentrouter phải truy cập được. Không đạt thì xóa máy, thử IP hoặc vị trí khác.
2. **Hardening và cắt gọn:**
   - User `deploy`, chỉ đăng nhập bằng key.
   - `PermitRootLogin no`, `PasswordAuthentication no`.
   - Gỡ các gói thừa ở mục 5, tắt cloud-init sau lần boot đầu, giữ `unattended-upgrades`.
   - Bật `systemd-timesyncd` (đồng hồ chuẩn cần cho mốc đóng nến).
3. **zram, swap, sysctl, journald** theo mục 5. Kiểm tra bằng `swapon --show` và `zramctl`.
4. **Node 22 LTS và OmniRoute slim:**
   - Cài từ tarball chính thức, `npm i -g omniroute@3.8.52`.
   - Tạo user `omniroute` và thư mục `/var/lib/omniroute`.
   - Tạo `.env` với quyền `0600`, chỉ chứa các biến bí mật ở mục 7.
   - Cài `docs/deploy/omniroute.service`. Cấu hình provider agentrouter qua SSH tunnel và bật API key.
5. **Copilot:**
   - Cài `uv`, copy artifact, `uv sync --no-dev`, `python -m compileall`.
   - Tạo `/etc/cryptosignal/copilot.env` (`0600`) và unit `cryptosignal-copilot.service` (mục 4, mục 8).
   - Migration tự chạy khi khởi động.
6. **nginx:**
   - Cài nginx 1.26 từ repo Debian và đặt chứng chỉ Origin CA.
   - Cấu hình theo mục 6.
   - rsync `out/` từ Mac hoặc CI, trỏ symlink `current`.
7. **systemd:** `systemctl enable --now omniroute cryptosignal-copilot nginx cryptosignal-backup.timer`.
8. **Smoke test:**
   - `curl` tới Binance ping.
   - `curl -H "Authorization: Bearer <key>" 127.0.0.1:20128/v1/models` (gõ key tay, không lưu vào lịch sử shell).
   - `curl https://<tên miền>/v1/copilot/health`.
   - Chạy **một lượt phân tích thật** trên web.
   - Kiểm tra `free -m`, `systemd-cgtop`, `journalctl -k | grep -i oom`.
9. **Theo dõi 48 giờ** [cấu hình]: RSS của OmniRoute (rò rỉ #17283), số lần restart, swap và zram, độ trễ. Chỉ sau đó mới bàn chuyện ngừng Render/Vercel, và phải có OK của anh.

**Cập nhật sau này:** rsync `releases/<sha>`, đổi symlink, `systemctl restart cryptosignal-copilot`. Web chỉ cần đổi symlink. Lỗi thì đổi symlink về bản cũ.

**Backup:**
- `cryptosignal-backup.timer` chạy hằng ngày: `sqlite3 ... ".backup ..."`, giữ 14 bản [cấu hình], mã hóa (`age` hoặc `rclone crypt`), đẩy offsite.
- Dữ liệu OmniRoute (`/var/lib/omniroute`) cũng cần backup **có mã hóa**, vì chứa credential.
- Mỗi tháng thử khôi phục một lần.

**Giám sát:**
- Uptime ngoài cho `/` và `/v1/copilot/health`.
- `OnFailure=` gửi cảnh báo admin.
- Kiểm tra Binance mỗi 5 phút.

---

## 12. Sự cố thường gặp

| Triệu chứng | Kiểm tra | Xử lý |
|---|---|---|
| 502 từ nginx | `systemctl status cryptosignal-copilot`, `journalctl -u cryptosignal-copilot -n 100` | Restart; kiểm tra OOM |
| OmniRoute restart liên tục | `journalctl -u omniroute`, `systemctl show omniroute -p MemoryCurrent` | Nâng `MemoryHigh` lên 480M; kiểm tra rò rỉ #17283; cân nhắc `vhp-1c-1gb` hoặc nâng RAM (cần OK của anh) |
| Chậm, swap cao | `zramctl`, `vmstat 1` | Giảm `CALL_LOG_MAX_ENTRIES`; tạm tắt scheduler |
| Binance 451/403 | `curl` ping | Đổi IP hoặc vị trí (cần OK của anh) |
| "database is locked" | Transaction nào giữ lâu | Kiểm tra WAL và `busy_timeout` |
| Cloudflare 526 | Chứng chỉ Origin CA hết hạn hoặc sai | Cấp lại chứng chỉ, kiểm tra chế độ Full (strict) |

---

## 13. Câu hỏi mở
1. **O1:** các mục §10 của bản 26/10 (thay đổi #7 đến #13 ở trên) có thực sự đã được duyệt không? REPORT ghi "plus items in section 10" dưới tiêu đề approved.
2. **O2:** Debian 13 hay Ubuntu 24.04 cắt gọn?
3. **O3:** giá trị cuối cùng cho `MemoryHigh`/`MemoryMax` của OmniRoute (450M/560M theo REPORT hay 850M/1G theo bản nháp unit) và `OMNIROUTE_RSS_PRESSURE_MB` (800 hay 520)?
4. **O4:** backup offsite để ở đâu (R2, B2, ...)? Có cần Litestream không (RAM chưa đo)?
5. **O5:** tên miền và tài khoản Cloudflare nào? Bật proxy cho bản ghi nào?
6. **O6:** khi nào ngừng Render/Vercel?
7. **O7:** có commit `apps/copilot/uv.lock` không?
8. **O8:** có nâng rate limit mặc định của OmniRoute (60 req/phút, 350 ms) để probe model nhanh hơn không?

---

## Quyết định cần anh chốt

**Đã chốt (28/10):**
- ✅ **VPS:** Vultr `vc2-1c-1gb`, Singapore, $5/tháng. Không giữ phương án 2 GB. Đường nâng cấp là `vhp-1c-1gb` ($6).
- ✅ **Web:** Next static export, nginx phục vụ `out/` và proxy `/v1/copilot/` tới uvicorn `127.0.0.1:8787`. Build trên Mac hoặc CI.
- ✅ **OmniRoute:** chế độ slim (`server-ws.mjs` chạy thẳng, headless, heap 512, semi-space 2, tắt dịch vụ nền), bind loopback, bật API key, chỉ dùng provider agentrouter.
- ✅ **TLS:** Cloudflare proxy + Origin CA certificate, chế độ Full (strict). Firewall chỉ mở 22/80/443.
- ✅ **Scheduler auto-analysis:** chạy trong process copilot, `--workers 1`.
- ✅ **Thay đổi code #1 đến #6** (mục 9).
- ✅ **zram bắt buộc**, cộng swapfile 1 GB và sysctl ở mục 5.

**Còn mở:**
1. **OS:** *Đề xuất:* **Debian 13** (stable, bản 13.7; dư hơn Ubuntu ~50 MB RAM [ước tính]; Python 3.13 khớp với số đo).
2. **Giới hạn bộ nhớ OmniRoute:** *Đề xuất:* `MemoryHigh=450M`, `MemoryMax=560M`, `OOMScoreAdjust=300`, `RuntimeMaxSec=1d` (theo REPORT), và **`OMNIROUTE_RSS_PRESSURE_MB=520`** (dưới `MemoryMax`). Nếu thấy chậm thì nâng `MemoryHigh` lên 480M.
3. **Xác nhận các mục §10 cũ** (#7 đến #13): *Đề xuất:* duyệt hết. Ưu tiên **#10 (drain loop)**, vì scheduler nay chạy chung process, và **#11 (IP qua Cloudflare)**.
4. **Backup:** *Đề xuất:* timer `sqlite3 .backup` hằng ngày cộng `rclone crypt` lên R2 hoặc B2. Chưa dùng Litestream cho đến khi đo được RAM của nó trên VPS.
5. **Kiểm tra Binance từ IP Vultr SG** trước khi dùng lâu dài: *Đề xuất:* tạo instance tính theo giờ, chạy smoke test bước 1, rồi mới giữ máy.
6. **Thời điểm ngừng Render/Vercel:** *Đề xuất:* sau 48 giờ chạy ổn trên VPS. Không đổi gì khi chưa có OK của anh.
7. **Rate limit OmniRoute:** *Đề xuất:* nâng giới hạn cho riêng key của copilot nếu probe model chậm. Giữ mặc định cho các key khác.

---

## Nguồn tham khảo
(Kiểm tra ngày 28/10/2026)

**Dữ liệu đo nội bộ (trên box)**
- `/workspace/vps/REPORT_vultr_1gb.md`
- `/workspace/vps/omniroute.service`
- `/workspace/vps/omniroute-slim-mac.sh`
- `/workspace/vps/run/bench.out`
- `/workspace/omb/{A,B,C384,C512,D,E,F,H,I,J,L,M}.out`
- Phiên đo 26/10 (Next standalone, Caddy, build Next, OmniRoute qua CLI)

**Repo (tại `97369f58`)**
- `apps/copilot/pyproject.toml`
- `apps/copilot/src/cryptosignal_copilot/{app.py, model_factory.py, symbol_tick.py, config.py, rate_limit.py, db/engine.py, model_probe.py}`
- `apps/web/{next.config.ts, app/v1/copilot/[...path]/route.ts, lib/copilot-api.ts, lib/binance.ts}`
- `render.yaml`, `deploy/cloudrun/deploy.sh`, `docs/AUTO_ANALYSIS_SPEC.md`

**Vultr**
- Danh sách gói (public API, không cần auth): https://api.vultr.com/v2/plans
- Image OS: https://api.vultr.com/v2/os
- Bảng giá: https://www.vultr.com/pricing/

**Debian, Node, OmniRoute**
- Debian releases (13 "trixie", 13.7 ngày 12/9/2026): https://www.debian.org/releases/
- Phiên bản gói trixie (nginx 1.26.3, python3 3.13.5, nodejs 20.19.2, rust-zram-generator 1.2.1, zram-tools 0.3.7): https://sources.debian.org
- Node.js releases (v22.23.4 LTS "Jod"): https://nodejs.org/dist/index.json
- OmniRoute npm (3.8.52): https://registry.npmjs.org/omniroute/latest
- OmniRoute repo: https://github.com/cheaper-inference/OmniRoute (trước là `diegosouzapw/OmniRoute`)
  - Issue #17283, #17284 và PR #17282: https://github.com/cheaper-inference/OmniRoute/issues/17283

**Cloudflare**
- Origin CA (có ở gói Free, không nhắc hết hạn, Full strict): https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/
- Connection limits (Proxy Read Timeout 125 s): https://developers.cloudflare.com/fundamentals/reference/connection-limits/

**Binance**
- Market data only: https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md

**Chưa xác minh**
- Truy cập Binance từ IP Vultr SG.
- Mọi số đo trên VPS thật. Các số hiện tại đo trên box, với LLM giả lập.
- RAM của OS (ước tính theo REPORT).
- Tên gói nhị phân zram trên Debian 13.
- `Type=notify` của `server-ws.mjs`.
- RAM của Litestream.
- Phạm vi drain loop.
