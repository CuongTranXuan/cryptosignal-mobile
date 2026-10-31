# AUTO_ANALYSIS_SPEC: Động cơ phân tích tự động định kỳ và cảnh báo Telegram/Zalo

> **Trạng thái:** BẢN NHÁP để anh review. Chưa có code nào được viết theo spec này.
> **Ngày:** 26/10/2026 (ICT, UTC+7). Mọi giá, hạn mức và chính sách bên ngoài đã kiểm tra trong tháng 10/2026, xem **Nguồn tham khảo**. Mục nào chưa xác minh được ghi rõ **[chưa xác minh]**. Mục nào là giả định ghi **[giả định]**.
> **Phạm vi:** spec sản phẩm và kỹ thuật cho một engine chạy định kỳ (1h/2h, cấu hình được) quét watchlist. Engine sinh tín hiệu mua/bán *có cấu trúc* và chỉ đẩy qua Telegram/Zalo khi tín hiệu thực sự có ý nghĩa.
> **Tài liệu liên quan:** `docs/CHART_AI_SPEC.md` (pipeline detector → candidate → LLM chọn), `docs/MODEL_SELECTION_SPEC.md` (ngân sách token), `docs/OMNIROUTE_CONFIG.md`, `docs/VPS_DEPLOY_PLAN.md` (nơi chạy engine).

---

## 0. Tóm tắt một trang

- **Mâu thuẫn cốt lõi với N18/N21:** chat copilot đã được siết để *không có lời khuyên giao dịch nào do model tự viết* đến tay người dùng. Phần tóm tắt tiếng Việt do server viết (`server_summary.py`). LLM chỉ được chọn `candidate_id` (`drawing_intent.py`, `wire_guardrail.py`). Engine tự động **giữ nguyên nguyên tắc đó**:
  - Tín hiệu được suy ra **tất định (deterministic)** từ sự kiện của detector, bộ lọc regime và căn chỉnh HTF.
  - Giá vào, mức vô hiệu (invalidation), mục tiêu và độ tin cậy đều do **code** tính.
  - LLM (qua OmniRoute) chỉ được **xác nhận hoặc phủ quyết (confirm/veto)** bằng trường có cấu trúc. LLM không viết câu chữ nào gửi cho người dùng.
  - Văn bản gửi đi là **template do server render**, có disclaimer.
- **Kiến trúc đề xuất:**
  - Một service systemd riêng `cryptosignal-autoscan`, chạy APScheduler 3.11.x (`AsyncIOScheduler`) hoặc systemd timer.
  - Chạy ngay sau khi nến đóng, cộng jitter.
  - Bảng job/tín hiệu/outbox nằm trong cùng DB SQLite (WAL) với copilot.
  - Gọi **trực tiếp hàm Python** của pipeline, không gọi HTTP `/v1/copilot/analyze`, vì endpoint này có drain loop "superseded" (xem §3.3).
- **Chống nhiễu:** chỉ gửi khi trạng thái thay đổi, dùng dedup key, cooldown theo (symbol, TF, hướng), hysteresis, giờ yên lặng và gom tin (batch).
- **Đo lường:** mỗi tín hiệu được theo dõi đến khi chạm mục tiêu, chạm invalidation hoặc hết hạn. Ghi MFE/MAE và thời gian ra kết quả, hiệu chỉnh độ tin cậy theo bucket (Brier), công khai track record, tự hạ cấp setup yếu.
- **Kênh:**
  - **Telegram trước**: miễn phí, Bot API đơn giản, người dùng chủ động `/start`.
  - **Zalo sau, có điều kiện**: chỉ qua **Tin Tư vấn của OA** trong khung tương tác. **ZBS Template Message (thay ZNS từ 01/01/2026) không phù hợp** vì quy định kiểm duyệt cấm nội dung về tiền ảo. OA Open API cần gói **Tăng trưởng** trở lên. Lĩnh vực tài chính cần xác thực "Cách 3".
- **Pháp lý: rủi ro CAO.**
  - Theo Nghị quyết 05/2025/NQ-CP Điều 4.4, chỉ tổ chức được Bộ Tài chính cấp phép mới được "cung cấp dịch vụ liên quan đến tài sản mã hóa và quảng cáo, tiếp thị liên quan đến tài sản mã hóa".
  - Nghị định 284/2026/NĐ-CP (hiệu lực 01/9/2026) Điều 7.4 phạt 180–200 triệu đồng (tổ chức) cho các hành vi này.
  - Tính đến 23/10/2026 **chưa có tổ chức nào được cấp phép**.
  - → Đề xuất chỉ chạy **nội bộ/beta kín**, không link sàn hay affiliate, và **phải hỏi luật sư trước khi mở công khai**.

---

## 1. Bối cảnh trong repo (đã đọc code tại `61b86fc5`)

| Thành phần | File | Ý nghĩa cho engine tự động |
|---|---|---|
| Endpoint phân tích | `apps/copilot/src/cryptosignal_copilot/app.py` (`POST /v1/copilot/analyze`) | Nhận `closedCandles` **từ client**: trình duyệt tự lấy nến từ `https://api.binance.com` (`apps/web/lib/binance.ts`). Server chỉ tự lấy nến cho HTF. → Engine cần **tự lấy nến phía server**. |
| Lấy nến server | `klines.py` | Dùng `https://data-api.binance.vision/api/v3/klines` (limit ≤ 1000). Tái sử dụng được. |
| Chuẩn bị/HTF | `analyze_prep.py` (`_htf_context`) | Đã lọc **chỉ nến đã đóng** (`c.time + htf_sec <= ltf_close`). Giữ nguyên nguyên tắc không nhìn trước (lookahead). |
| Regime | `chart_regime.py` (`detect_regime`) | Trả về `trend_up` / `trend_down` / `range` / `volatile`, dựa trên ZigZag, EMA20/50 và quy tắc ATR. Đây là bộ lọc regime. |
| Candidate | `candidates.py` (`build_candidate_catalog(candles, *, symbol, interval)`) | `DrawingCandidate` có `pattern_id`, `score`, `invalidation_price`, `break_time`, `evidence_against`. Đây là nguồn sự kiện của detector. Đo trên box: ~10 ms/lần với 200 nến 1h. |
| Độ tin cậy | `drawing_intent.py` (`confidence_from_score`, `invalidation_condition`) | Công thức tất định có sẵn. Tái sử dụng làm `confidence_raw`. |
| Sự kiện phân tích | `analysis_events.py` (`build_analysis_event`, `regime_to_bias`) | Đã có `bias`, `evidence_for/against`, `invalidation`, `confidence`. Đây là khuôn mẫu cho `Signal`. |
| Tóm tắt server | `server_summary.py` (`summary_direction_from_regime`) | Câu chữ tiếng Việt do server viết. Engine dùng cùng cách (template). |
| Gate/guardrail | `drawing_gate.py`, `pattern_invalidation.py`, `wire_guardrail.py` | Dùng lại để loại pattern đã vô hiệu hoặc yếu trước khi phát tín hiệu. |
| Giá tick | `symbol_tick.py` | Tải `exchangeInfo` (~17,8 MB) đồng bộ. Đo trên box: +114 MB RSS đỉnh. Xem đề xuất trong `docs/VPS_DEPLOY_PLAN.md`. |
| Rate limit | `rate_limit.py` (`SlidingWindowRateLimiter`) | In-memory, theo IP. Không áp dụng cho engine nội bộ. |
| DB | `db/engine.py`, `db/models.py`, Alembic `20251014_0001`, `20251025_0002` | Thêm bảng mới bằng migration thứ 3 (§9). |

---

## 2. Hòa giải với N18/N21: "LLM không được ra lệnh giao dịch"

### 2.1 Nguyên tắc (bất biến)
1. **Mọi trường số trong tín hiệu đều do code tính**: hướng, entry, invalidation, target, confidence, thời hạn. Không có trường nào lấy từ text của LLM.
2. **LLM chỉ trả về JSON có schema** (pydantic, giống `AnalyzeResultLlm`):
   ```
   SignalReview {
     signal_id: str              # phải trùng với id server gửi
     verdict: "confirm" | "veto" | "abstain"
     reason_codes: list[ReasonCode]   # enum đóng, ví dụ: htf_conflict, weak_structure,
                                      # news_risk_unknown, overextended, low_volume, ok_confluence
     quality: "strong" | "ok" | "weak"
   }
   ```
   Không có trường `text`. Nếu LLM trả `reason` dạng tự do thì server **bỏ đi** (giống cách `wire_guardrail.py` đang lọc).
3. **LLM chỉ được giảm, không được tăng.** `veto` ⇒ không gửi. `confirm` ⇒ giữ nguyên confidence (có thể +1 bucket nếu calibration chứng minh có giá trị, §6.4). `abstain` hoặc lỗi ⇒ theo chính sách `llm_failure_mode` (§10.3).
4. **Văn bản gửi đi = template server** (§8.4): toàn trường có cấu trúc, cộng disclaimer cố định và link tới trang track record.
5. **Có thể tắt LLM hoàn toàn** (`AUTOSCAN_LLM_MODE=off`). Khi đó engine vẫn chạy được, chỉ thuần detector. Đây là chế độ mặc định của Phase 0.

### 2.2 Vì sao cách này thỏa N18/N21
- Người dùng không bao giờ thấy câu chữ do model viết, nên không có rủi ro model "bịa" giá hay hứa hẹn lợi nhuận.
- Cùng đầu vào thì cho cùng tín hiệu (chỉ trừ bước veto). Điều này giúp backtest và calibration có nghĩa.
- **Câu hỏi mở cho anh:** N18/N21 có cho phép *bất kỳ* nội dung mang tính "mua/bán" nào gửi chủ động (push) không? Kể cả khi do code sinh ra? Nếu không, engine chỉ nên gửi "**cảnh báo cấu trúc**" (ví dụ "BTCUSDT 1h: phá vỡ kênh giảm, vô hiệu nếu đóng dưới X"), không dùng từ "MUA/BÁN". Xem thêm §11 (pháp lý), nơi cách diễn đạt này cũng giảm rủi ro.

---

## 3. Kiến trúc

### 3.1 Sơ đồ
```
            ┌──────────── cryptosignal-autoscan (systemd service, 1 process) ────────────┐
 scheduler ─┤ tick (sau khi nến đóng + jitter)                                            │
            │   └─ enqueue scan_jobs(symbol, tf, bar_close_time)  ──► SQLite (WAL)         │
            │ worker (asyncio, concurrency=2)                                             │
            │   1. fetch klines (data-api.binance.vision, chỉ nến đã đóng)                 │
            │   2. build_candidate_catalog + detect_regime + HTF context (tái dùng code)  │
            │   3. derive_signal()  (tất định)                                            │
            │   4. state hash → không đổi?  → dừng (không gọi LLM)                        │
            │   5. LLM review (OmniRoute, tùy chọn) → confirm/veto                       │
            │   6. anti-noise gate (dedup, cooldown, hysteresis, quiet hours)            │
            │   7. ghi signals + outbox (cùng 1 transaction)                             │
            │ dispatcher: đọc outbox → Telegram / Zalo, retry + idempotency               │
            │ tracker: mỗi nến đóng → cập nhật outcome các tín hiệu đang mở               │
            └─────────────────────────────────────────────────────────────────────────────┘
 cryptosignal-copilot (uvicorn) ── đọc cùng DB để hiển thị track record / cài đặt
```

### 3.2 Chọn bộ lập lịch

| Phương án | Ưu | Nhược | Kết luận |
|---|---|---|---|
| **APScheduler 3.11.x** `AsyncIOScheduler` trong service riêng | Cùng ngôn ngữ, cùng event loop với httpx/pydantic-ai. Cron trigger theo phút sau nến đóng. Có `SQLAlchemyJobStore`. | Bản 4.0 vẫn là pre-release (4.0.0a6), **không dùng**. Phải tự đặt `coalesce=True`, `max_instances=1`, `misfire_grace_time` (≈ 300 s) một cách tường minh, không dựa vào mặc định **[mặc định chưa xác minh]**. | **Đề xuất** |
| systemd timer (`OnCalendar=*:00:20`) gọi CLI `python -m cryptosignal_copilot.autoscan run-once` | Rất nhẹ RAM (process chỉ sống khi chạy). Log nằm trong journald. `Persistent=true` chạy bù sau khi reboot. | Mỗi lần chạy phải khởi động Python và import (đo được ~1,8 s, ~163 MB). Dispatcher retry cần process sống lâu, hoặc một timer thứ hai. | Phương án dự phòng nếu RAM 1 GB quá chật |
| Cron | Có sẵn | Log và khóa chồng chéo phải tự lo | Không chọn |
| Chạy trong process uvicorn | Không tốn thêm process | Tranh CPU/RAM với request người dùng. Lỗi engine kéo sập API. Nếu sau này chạy nhiều worker thì job bị nhân đôi. | Không chọn (chi tiết ở `docs/VPS_DEPLOY_PLAN.md` §9) |

**Hàng đợi nhẹ:** dùng ngay bảng `scan_jobs` trong SQLite (`status`, `locked_at`, `attempts`), không cần Redis hay Celery. Chỉ có 1 process tiêu thụ nên không cần khóa phân tán. Với SQLite, `BEGIN IMMEDIATE` là đủ.

### 3.3 Vì sao không gọi HTTP `/v1/copilot/analyze`
- `app.py` có vòng drain toàn cục (`state_lock`, `latest_request`, sự kiện "superseded"). Request mới thay thế request đang chờ. Nếu engine gọi qua HTTP, nó sẽ **đá request của người dùng thật** (hoặc ngược lại). Coder nên xác nhận lại phạm vi của khóa này (theo process hay theo client).
- Endpoint có rate limit theo IP và kỳ vọng `closedCandles` từ client.
- → Tách lõi pipeline thành hàm thuần `run_scan(symbol, interval, candles, htf_candles, cfg) -> ScanResult` trong module mới `apps/copilot/src/cryptosignal_copilot/autoscan/`. Cả `app.py` và engine cùng gọi hàm đó.

### 3.4 Thời điểm chạy, chỉ dùng nến đã đóng
- Chạy job TF `X` tại `bar_close + 20–40 s` (jitter ngẫu nhiên theo symbol) để Binance kịp chốt nến và tránh dồn request.
- Lấy `limit = window + 1` nến. **Bỏ nến cuối nếu `open_time + tf_sec > now`**: nến chưa đóng không bao giờ được dùng.
- Ghi `bar_close_time` vào mọi tín hiệu. Dedup key và tracker đều dựa trên nó.
- Tần suất cấu hình `AUTOSCAN_EVERY` = `1h` | `2h`. Nếu TF nhỏ hơn tần suất (ví dụ 15m mà quét 1h), chỉ đánh giá tại nến đóng gần nhất. Không quét bù các nến 15m ở giữa, để tránh dồn tín hiệu cũ.

---

## 4. Mô hình tín hiệu

### 4.1 Schema
```
Signal {
  id: str                    # ulid
  symbol: str                # "BTCUSDT"
  interval: "15m"|"1h"|"4h"|"1d"
  bar_close_time: int        # ms, nến kích hoạt (đã đóng)
  direction: "long"|"short"  # hiển thị "Xu hướng tăng/giảm", xem §2.2
  setup_id: str              # pattern_id + style, vd "channel_break:classic"
  candidate_id: str          # id trong CandidateCatalog
  trigger: str               # enum: breakout_close, retest_hold, regime_flip, ...
  entry_ref: float           # = close của nến kích hoạt (tham chiếu, không phải lệnh)
  invalidation: float        # = DrawingCandidate.invalidation_price, hoặc swing gần nhất ± k·ATR
  targets: [float, float]    # T1 = entry ± 1R, T2 = mục tiêu đo theo hình học pattern, giới hạn 3R
  rr_t1: float
  confidence_raw: float      # confidence_from_score(score, touches)
  confidence: float          # sau calibration (§6.4)
  confidence_bucket: "thấp"|"trung bình"|"cao"
  regime_ltf: str, regime_htf: str
  llm_verdict: "confirm"|"veto"|"abstain"|"skipped"|"error"
  state_hash: str            # hash(setup_id, candidate geometry rounded, regime, htf)
  expires_at: int            # bar_close_time + N_bars·tf (mặc định N=24)
  status: "open"|"hit_t1"|"hit_t2"|"invalidated"|"expired"|"vetoed"|"suppressed"
}
```

### 4.2 Quy tắc suy ra (`derive_signal`, tất định)
1. **Sự kiện detector:** một candidate có `break_time == bar_close_time` (phá vỡ xác nhận bằng giá đóng cửa), hoặc retest giữ được, hoặc `detect_regime` đổi từ `range` sang `trend_*`.
2. **Bộ lọc regime:**
   - `long` chỉ khi regime LTF ∈ {`trend_up`, `range` có breakout lên}.
   - Hướng ngược với regime HTF ⇒ hạ 1 bucket, hoặc bỏ nếu `AUTOSCAN_REQUIRE_HTF_ALIGN=1`.
   - `volatile` ⇒ không phát (ATR cao bất thường).
3. **Hình học:**
   - `invalidation` bắt buộc phải có. Thiếu ⇒ không phát.
   - `R = |entry_ref − invalidation|`.
   - Loại nếu `R < 0.3·ATR` (quá sát, nhiễu) hoặc `R > 3·ATR` (quá xa).
4. **Ngưỡng:** `confidence_raw ≥ AUTOSCAN_MIN_CONF` (mặc định 0,55 **[giả định, cần backtest]**) và `rr_t1 ≥ 1`.
5. **Kiểm tra lại `pattern_invalidation.py`/`drawing_gate.py`:** pattern đã bị vô hiệu trên chính các nến đã đóng thì loại.
6. **Không lookahead:** mọi đặc trưng chỉ dùng nến có `close_time ≤ bar_close_time`. Phải có unit test cắt chuỗi nến tại `t` rồi so với chuỗi đầy đủ: tín hiệu tại `t` phải giống hệt nhau.

---

## 5. Luật chống nhiễu

| Luật | Mặc định | Ghi chú |
|---|---|---|
| Chỉ gửi khi đổi trạng thái | `state_hash` khác lần gửi gần nhất của (symbol, TF, hướng) | Hướng hoặc setup không đổi ⇒ im lặng |
| Dedup key | `sha1(symbol, interval, direction, setup_id, bar_close_time)`, UNIQUE trong `signals` | Chạy lại job không sinh bản trùng |
| Cooldown | 1h: 6 nến · 4h: 3 nến · 1d: 2 nến, theo (symbol, TF, hướng) | Tín hiệu ngược hướng được bỏ qua cooldown **chỉ khi** tín hiệu cũ đã `invalidated` |
| Hysteresis | Muốn phát lại cùng hướng thì giá phải ra khỏi vùng ±0,5·ATR quanh entry cũ, hoặc tín hiệu cũ đã đóng | Tránh "nhấp nháy" quanh đường phá vỡ |
| Ngưỡng tối thiểu | `confidence ≥ MIN_CONF`, `rr_t1 ≥ 1`, regime ≠ `volatile` | §4.2 |
| Trần mỗi người | ≤ 6 tin/ngày/người (cấu hình được) | Vượt trần ⇒ gom vào bản tóm tắt cuối ngày |
| Giờ yên lặng | 23:00–07:00 ICT (người dùng chỉnh được) | Tin trong giờ yên lặng được gom vào 07:00, **loại tin đã hết hạn hoặc đã invalidated trong lúc chờ** |
| Gom tin (batch) | Nhiều tín hiệu cùng một tick ⇒ 1 tin nhiều dòng | Giảm số tin (Telegram ~1 tin/giây/chat; Zalo tính theo tin) |
| Cập nhật vòng đời | Gửi tối đa 1 tin "kết quả" (chạm T1, T2 hoặc invalidation) cho mỗi tín hiệu, người dùng tắt được | Phục vụ minh bạch |

---

## 6. Theo dõi và chấm điểm

### 6.1 Tracker
- Mỗi khi nến TF đóng, với mọi tín hiệu `open`: duyệt high/low của nến **đã đóng**.
  - Chạm `invalidation` ⇒ `invalidated`.
  - Chạm T1 ⇒ `hit_t1` (tiếp tục theo dõi T2).
  - Quá `expires_at` ⇒ `expired`.
- Nếu một nến chạm cả T1 lẫn invalidation: tính là **invalidated** (bảo thủ, vì không biết thứ tự trong nến). Có thể tinh chỉnh bằng nến 1m nếu cần.

### 6.2 Chỉ số mỗi tín hiệu
- `outcome`, `bars_to_outcome`, `time_to_outcome`.
- `MFE` (biên lãi lớn nhất) và `MAE` (biên lỗ lớn nhất), đơn vị R và %.
- `r_multiple` cuối: +1 / +2 / −1 / giá trị lúc hết hạn.

### 6.3 Tổng hợp
- Theo `setup_id × interval × regime_htf`: số mẫu, hit-rate T1, R trung bình, kỳ vọng (expectancy), MFE/MAE trung vị.
- **Calibration:** chia `confidence` thành bucket 0,5–0,6 / 0,6–0,7 / 0,7+. So tần suất chạm T1 thực tế với confidence dự báo, tính **Brier score** và vẽ reliability diagram.

### 6.4 Tự hạ cấp setup yếu
- Một `setup_id × interval` có ≥ 30 mẫu **[giả định]** mà expectancy < 0 hoặc hit-rate T1 thấp hơn confidence trung bình quá 15 điểm % ⇒ tự chuyển sang `shadow`: vẫn ghi, vẫn chấm điểm, nhưng **không gửi**. Tự bật lại khi 30 mẫu gần nhất vượt ngưỡng.
- `confidence` hiển thị = giá trị đã hiệu chỉnh (isotonic hoặc bảng tra theo bucket), không phải `confidence_raw`.
- LLM `confirm` chỉ được cộng điểm nếu dữ liệu cho thấy nhóm `confirm` có hit-rate cao hơn nhóm `skipped` một cách có ý nghĩa. Nếu không, LLM chỉ còn vai trò veto.

### 6.5 Track record công khai
- Trang `/track-record` (web) đọc API `GET /v1/copilot/autoscan/stats` gồm: mọi tín hiệu đã gửi, **kể cả thua**, thời điểm gửi, kết quả. Không chỉnh sửa hồi tố.
- Đây là điều kiện để tin nhắn có link "xem lịch sử". **Lưu ý pháp lý §11**: trang công khai có thể bị coi là "quảng cáo, tiếp thị", nên chỉ bật sau khi có ý kiến luật sư.

---

## 7. Chi phí LLM qua OmniRoute

### 7.1 Số liệu nền (từ repo)
- `docs/MODEL_SELECTION_SPEC.md` §2.1: **54 token/nến** (đo trên `agentrouter/deepseek-v4-flash`), overhead hệ thống ~4.000.
- `docs/CHART_AI_SPEC.md` §6.2: luồng candidate mới ≈ **4–5k token input** mỗi lượt, bất kể cửa sổ nến. Output JSON ≤ ~2.000.
- Review của engine nhỏ hơn: chỉ gửi 1 tín hiệu, 30 nến compact và tóm tắt HTF. **[giả định]** ~3k input, ~1k output (cộng reasoning `low`, giả định ~1k).

### 7.2 Ví dụ ngân sách **[toàn bộ là giả định để minh họa]**
- Watchlist: 10 symbol × {1h, 4h}, quét mỗi giờ ⇒ 10×24 + 10×6 = **300 lượt đánh giá tất định/ngày** (không tốn token).
- Tỷ lệ có "đổi trạng thái" cần LLM: 10% ⇒ **30 lượt LLM/ngày** ≈ 900/tháng.
- Token/tháng: 900 × (3k in + 2k out) ≈ **2,7M input + 1,8M output**.
- Đơn giá tham chiếu công khai cho **DeepSeek-V4-Flash** trên trang giá serverless của Vultr: **$0,30/M input, $1,00/M output**. Đơn giá thực của agentrouter/OmniRoute **[chưa xác minh]**, cần anh kiểm tra trên dashboard agentrouter.
- ⇒ ≈ 2,7×0,30 + 1,8×1,00 ≈ **$2,6/tháng**.
- Trường hợp xấu (LLM mọi lượt, 300/ngày): ≈ **$26/tháng**.

### 7.3 Giảm chi phí
1. **Bỏ qua LLM khi `state_hash` không đổi.** Đây là phần lớn các lượt.
2. Cache kết quả review theo `state_hash` trong 1 nến TF.
3. Chỉ review tín hiệu **đã qua** mọi gate tất định. Không review tín hiệu sẽ bị cooldown chặn.
4. Serializer nến compact `[t,o,h,l,c,v]`, ~25–32 token/nến (`MODEL_SELECTION_SPEC.md` §2.1, chưa đo cho luồng này).
5. `reasoning_effort="low"` hoặc `none`. Timeout ngắn hơn chat (ví dụ 60 s), vì engine không cần trả lời ngay.
6. Ngân sách cứng: `AUTOSCAN_LLM_DAILY_CALLS` (mặc định 100). Vượt ⇒ `skipped`, chạy chế độ thuần detector.
7. Concurrency LLM = 1 (semaphore) để không chiếm OmniRoute khi người dùng đang chat.

---

## 8. Kênh gửi: Telegram và Zalo

### 8.1 Telegram (đề xuất cho beta)
- **Cách hoạt động:**
  - Bot không thể nhắn trước. Người dùng phải `/start` (lấy `chat_id`).
  - Đăng ký và hủy bằng lệnh `/watch BTCUSDT 1h`, `/stop`, `/quiet 23-7`.
- **Webhook hay polling:**
  - Webhook cần HTTPS hợp lệ trên cổng 443/80/88/8443.
  - `getUpdates` (long polling) không cần mở cổng. → Với VPS sau Cloudflare Tunnel, **long polling** là đơn giản nhất.
- **Giới hạn** (Bot FAQ):
  - ~1 tin/giây mỗi chat, 20 tin/phút trong một nhóm.
  - Broadcast miễn phí ~30 tin/giây.
  - Paid broadcast tới 1000 tin/giây, giá 0,1 Star/tin vượt mức, cần ≥ 100.000 Star và ≥ 100.000 MAU. Không liên quan ở quy mô beta.
  - `sendMessage` tối đa 4096 ký tự.
- **Điều khoản (Bot Developer Terms):**
  - Cấm spam hoặc tin không được yêu cầu (5.2b).
  - Cấm tạo điều kiện cho hàng hóa hoặc dịch vụ bị quản lý mà không tuân thủ (5.2h).
  - Bắt buộc có chính sách quyền riêng tư. Dữ liệu người dùng phải mã hóa khi lưu (4.4).
  - Tính năng crypto trong **Mini App** chỉ được dùng TON (mục 7). Ta không làm Mini App, chỉ bot tin nhắn.
  - Tuân thủ luật địa phương là trách nhiệm của nhà phát triển (mục 9).
- **Rủi ro tại VN:**
  - Telegram từng bị chặn ở Viettel/VNPT/FPT từ 25/5/2025, gỡ ngày 10/7/2025 (OONI).
  - Tình trạng hiện tại (10/2026) theo báo chí là không bị chặn **[chỉ xác minh một phần]**.
  - → Cần kênh dự phòng: web push hoặc email.
- **Chi phí:** 0đ.

### 8.2 Zalo: các loại tin và mức phù hợp

| Loại | Điều kiện | Chi phí | Phù hợp cho tín hiệu? |
|---|---|---|---|
| **Tin Tư vấn (OA)**, API `POST https://openapi.zalo.me/v3.0/oa/message/cs` | Người dùng phải tương tác với OA trước. Qua OpenAPI chỉ gửi được trong **7 ngày** kể từ tương tác cuối (OA Manager: 365 ngày). Text tối đa 2000 ký tự. | **Trong 48h từ tương tác cuối: miễn phí, không giới hạn** (tài liệu 2026). Ngoài 48h: dùng hạn mức gói (Tăng trưởng 500, Toàn diện 2.000 tin/tháng), hết hạn mức thì **55đ/tin**. Trang chính sách cũ còn ghi "8 tin miễn phí/48h", **mâu thuẫn, cần hỏi Zalo**. | **Có điều kiện**: hợp nếu người dùng "chạm" OA thường xuyên (ví dụ bấm nút "Tiếp tục nhận" trong tin). Quá 7 ngày không tương tác ⇒ không gửi được. |
| Tin Truyền thông (broadcast) | Chỉ gửi người quan tâm. Tối đa 4 tin/tháng và 1 tin/ngày mỗi người | Theo hạn mức gói | Không, quá ít |
| Tin Giao dịch | Chỉ nói về trạng thái giao dịch hoặc đơn hàng | — | Không đúng mục đích |
| **ZBS Template Message** (thay ZNS từ 01/01/2026) | Template duyệt ~2 ngày làm việc. Chỉ gửi cho người dùng **đã giao dịch** với doanh nghiệp. Không link trong nội dung, không viết tắt, không icon. Quy định kiểm duyệt (cập nhật 10/2026) **cấm "các vấn đề về đồng tiền ảo nói chung"** ở tag Hậu mãi. Vàng/forex cần NHNN chấp thuận. | 300–400đ/tin (chưa VAT, bảng giá từ 16/03/2026) | **Không** |
| Mini App / OA Extension | Chính sách Extension cấm sản phẩm blockchain/crypto | — | Không |

**Yêu cầu nền cho Zalo:**
- **OA phải được xác thực.** Nộp hồ sơ trong 14 ngày, nếu không OA bị khóa. Kết quả có sau 2–3 ngày làm việc. Lĩnh vực tài chính, ngân hàng phải theo "**Cách 3**", cần giấy phép kinh doanh có điều kiện. Với crypto hiện **không có giấy phép nào** để nộp (§11), nên khả năng bị từ chối là cao **[suy luận, chưa thử]**.
- **Open API chỉ có ở gói Tăng trưởng trở lên.** Bảng giá từ 1/6/2026, đã gồm VAT:
  - Cơ bản: miễn phí.
  - Tiêu chuẩn: 1.000.000đ/năm.
  - **Tăng trưởng: 1.400.000đ/6 tháng hoặc 2.500.000đ/năm** (100 req/phút).
  - Toàn diện: 3.400.000đ/6 tháng hoặc 6.000.000đ/năm (2.000 req/phút).
- Giới hạn cấp ứng dụng là 4.000 req/phút cho OA API.
- Access token sống 25 giờ. Refresh token sống 3 tháng và **chỉ dùng một lần**. → Phải lưu token mới sau mỗi lần refresh, trong secret store và có khóa ghi. Nếu không, sẽ mất quyền gửi.
- OA bị khóa nếu 180 ngày không hoạt động, hoặc nếu vi phạm chính sách.

### 8.3 Kết luận kênh
1. Phase 1: **Telegram**.
2. Phase 2: **Zalo Tin Tư vấn**, chỉ khi (a) luật sư đồng ý, (b) OA xác thực được, (c) chấp nhận phí gói Tăng trưởng ≥ 2,5 triệu/năm.
3. **Không dùng ZBS/ZNS.**

### 8.4 Template tin (server render, ví dụ)
```
[CryptoSignal · Cảnh báo cấu trúc] BTCUSDT · 1h · nến đóng 14:00 ICT
Xu hướng: TĂNG (phá vỡ kênh giảm, HTF 4h: tăng)
Giá tham chiếu: 67.250 · Vô hiệu nếu đóng dưới: 66.480
Mốc theo dõi: 68.020 (1R) · 68.790 (2R)
Độ tin cậy (đã hiệu chỉnh): Trung bình (62%) · Hết hiệu lực sau 24 nến
Đây là thông tin phân tích kỹ thuật tự động, KHÔNG phải khuyến nghị đầu tư. Bạn tự chịu trách nhiệm với quyết định của mình.
Lịch sử tín hiệu: <link> · Tắt: /stop
```
- Không có link sàn, không có mã giới thiệu, không có từ "chắc chắn", không dùng emoji tên lửa.
- Bản Zalo: bỏ link trong nội dung nếu chính sách yêu cầu; nút "Tiếp tục nhận" để làm mới khung tương tác.

---

## 9. Lưu trữ (migration Alembic thứ 3, đề xuất)
- `autoscan_watchlist(id, owner_id, symbol, interval, enabled, created_at)`
- `autoscan_subscribers(id, channel{telegram,zalo}, external_id_enc, display_name, quiet_from, quiet_to, min_conf_bucket, max_per_day, directions, intervals_json, symbols_json, lifecycle_updates, opted_in_at, opted_out_at, last_interaction_at)`
  - `external_id_enc` (chat_id/user_id Zalo) được **mã hóa khi lưu** theo yêu cầu điều khoản Telegram 4.4. Khóa lấy từ env, **không commit**.
- `scan_jobs(id, symbol, interval, bar_close_time, status, attempts, locked_at, error, created_at)`, UNIQUE(symbol, interval, bar_close_time).
- `signals(...)` theo §4.1, UNIQUE(dedup_key), index (symbol, interval, direction, created_at).
- `signal_outcomes(signal_id, outcome, bars_to_outcome, mfe_r, mae_r, r_multiple, closed_at)`
- `outbox(id, signal_id, subscriber_id, channel, payload_json, idempotency_key UNIQUE, status, attempts, next_attempt_at, provider_msg_id, last_error)`
- `llm_reviews(signal_id, state_hash, model, verdict, reason_codes, prompt_tokens, completion_tokens, latency_ms)`
- Lưu giữ: `scan_jobs` 14 ngày; `signals` và `outcomes` vĩnh viễn (phục vụ track record); `outbox` 90 ngày.

---

## 10. Xử lý lỗi

### 10.1 Dữ liệu thị trường
- Mặc định dùng `data-api.binance.vision` (endpoint REST công khai chỉ cho market data). **Không** dùng `api.binance.com` từ server: Render ở Oregon từng trả **HTTP 451**.
- Đặt VPS ở SG/VN (`docs/VPS_DEPLOY_PLAN.md`).
- **451/403** ⇒ đánh dấu `market_data_blocked`, dừng mọi job, gửi cảnh báo cho admin (1 lần/giờ), **không phát tín hiệu từ dữ liệu cũ**.
- **429/418** (rate limit Binance) ⇒ tôn trọng `Retry-After`, giảm concurrency xuống 1.
- Kiểm tra toàn vẹn dữ liệu:
  - Thiếu nến (khe thời gian) hoặc nến cuối chưa đóng ⇒ bỏ job, `attempts+1`, retry sau 60 s, tối đa 3 lần.
  - Nến quá cũ (> 2 TF) ⇒ không phát.

### 10.2 Mất điện hoặc khởi động lại
- Job được lưu trong DB. Khi khởi động: job `running` có `locked_at` > 10 phút ⇒ đưa về `pending`.
- Job trễ quá `misfire_grace_time` ⇒ **bỏ, không chạy bù**. Tín hiệu trễ thì vô nghĩa và có hại.
- Tracker chạy bù bình thường: kết quả là dữ liệu lịch sử nên luôn chính xác.

### 10.3 LLM / OmniRoute
- Timeout 60 s, retry 0 lần (engine không vội).
- Fallback theo `AUTOSCAN_LLM_FAILURE_MODE`:
  - `send_unreviewed`: mặc định cho beta, gắn nhãn "chưa qua kiểm tra AI".
  - `hold`: không gửi.
- Circuit breaker: 3 lỗi liên tiếp ⇒ bỏ qua LLM 30 phút.
- **Lưu ý:** provider `cursor/*` trong OmniRoute phụ thuộc `cursor-agent` CLI. `docs/OMNIROUTE_CONFIG.md` ghi nhận có thể mất ~18 s mới báo 502. Engine nên ghim `agentrouter/deepseek-v4-flash`.

### 10.4 Gửi tin
- **Outbox pattern:** tín hiệu và các dòng outbox được ghi trong *cùng* transaction. Dispatcher gửi riêng.
- `idempotency_key = sha1(dedup_key, subscriber_id, channel)`. Đã `sent` thì không gửi lại.
- Retry với backoff mũ (30 s, 2 phút, 10 phút, 1 giờ). Lỗi vĩnh viễn thì bỏ:
  - Telegram 403 "bot was blocked" ⇒ tự `opted_out`.
  - Zalo ngoài khung 7 ngày.
- Telegram 429 ⇒ đọc `retry_after`.
- Tin quá hạn (tín hiệu đã `invalidated`/`expired` khi tới lượt gửi) ⇒ hủy.
- Rủi ro trùng còn lại: gửi thành công nhưng chưa kịp ghi `sent` thì process chết ⇒ có thể trùng 1 tin. Chấp nhận được; ghi log `provider_msg_id`.

---

## 11. Pháp lý và rủi ro (Việt Nam). **Không phải ý kiến pháp lý**

| Văn bản | Nội dung liên quan |
|---|---|
| **Luật Công nghiệp công nghệ số 71/2025/QH15** (hiệu lực 01/01/2026), Điều 46–47 | Định nghĩa tài sản số và tài sản mã hóa; giao Chính phủ quy định chi tiết. |
| **Nghị quyết 05/2025/NQ-CP** (09/9/2025, thí điểm 5 năm) | **Điều 4.4:** "Chỉ tổ chức được Bộ Tài chính cấp Giấy phép cung cấp dịch vụ tổ chức thị trường giao dịch tài sản mã hóa được thực hiện hoạt động cung cấp dịch vụ liên quan đến tài sản mã hóa và **quảng cáo, tiếp thị liên quan đến tài sản mã hóa**." Điều 3.3 liệt kê các dịch vụ CASP (không nhắc rõ "tư vấn"). Điều 7.2: 6 tháng sau khi có CASP đầu tiên được cấp phép, nhà đầu tư trong nước giao dịch ngoài CASP được cấp phép sẽ bị xử lý. Điều 8: vốn tối thiểu 10.000 tỷ đồng. Điều 16.2: nhà đầu tư tự chịu trách nhiệm. |
| **Nghị định 284/2026/NĐ-CP** (hiệu lực 01/9/2026), **Điều 7.4** | Phạt **180–200 triệu đồng** (tổ chức) đối với (a) cung cấp dịch vụ liên quan đến tài sản mã hóa khi chưa có giấy phép và (b) **quảng cáo, tiếp thị** liên quan đến tài sản mã hóa khi chưa có giấy phép. Cá nhân bị phạt một nửa (90–100 triệu). Biện pháp khắc phục gồm gỡ website/phần mềm và cải chính quảng cáo. |
| Tình trạng cấp phép | Tính đến **23/10/2026: chưa có CASP nào được cấp phép**. 5 doanh nghiệp đã qua vòng 1 (VIXEX, SCEX, CAEX, TCEX, Moonbase). CAEX hoàn tất an ninh mạng cấp độ 4 ngày 22/10/2026. |

**Đánh giá:**
- Một dịch vụ **chủ động đẩy tín hiệu mua/bán crypto**, nhất là khi công khai, có track record "quảng bá" hoặc thu phí, có nguy cơ bị coi là "cung cấp dịch vụ liên quan" hoặc "quảng cáo, tiếp thị" theo Điều 4.4. → Rủi ro **cao**. Cách hiểu rộng hay hẹp của "dịch vụ liên quan" **[chưa có hướng dẫn được xác minh]**.
- **Biện pháp giảm rủi ro** (chỉ giảm, không loại bỏ):
  1. Beta kín, mời đích danh, miễn phí.
  2. Dùng ngôn ngữ "cảnh báo cấu trúc kỹ thuật" thay cho "khuyến nghị mua/bán".
  3. Disclaimer cố định.
  4. Không link sàn, không affiliate, không thu phí.
  5. Không quảng cáo công khai.
  6. Lưu log opt-in.
  7. Có chính sách quyền riêng tư.
- **Bắt buộc:** xin ý kiến luật sư (fintech/chứng khoán) trước Phase 2 và trước khi công khai track record.

---

## 12. Cài đặt người dùng
- Kênh (Telegram/Zalo), watchlist symbol (giới hạn trong danh sách admin cho phép), TF (`1h`, `4h`; `15m` chỉ cho admin), hướng (`long`/`short`/cả hai).
- Mức tin cậy tối thiểu (thấp/trung bình/cao), số tin tối đa mỗi ngày, giờ yên lặng (theo múi giờ người dùng, mặc định ICT), nhận cập nhật kết quả (bật/tắt), tóm tắt cuối ngày (bật/tắt).
- Admin (env/DB): `AUTOSCAN_EVERY`, `AUTOSCAN_SYMBOLS`, `AUTOSCAN_INTERVALS`, `AUTOSCAN_MIN_CONF`, `AUTOSCAN_REQUIRE_HTF_ALIGN`, `AUTOSCAN_LLM_MODE` (`off|veto|confirm`), `AUTOSCAN_LLM_DAILY_CALLS`, `AUTOSCAN_LLM_FAILURE_MODE`, `AUTOSCAN_DRY_RUN` (chỉ ghi DB, không gửi).

---

## 13. Lộ trình triển khai

| Phase | Nội dung | Tiêu chí qua phase |
|---|---|---|
| **0: Nội bộ, dry-run** (2–4 tuần) | `AUTOSCAN_DRY_RUN=1`, LLM `off`. Ghi tín hiệu và outcome vào DB. Chỉ gửi vào chat Telegram riêng của anh. Thêm backtest offline trên dữ liệu lịch sử bằng cùng hàm `derive_signal`. | ≥ 100 tín hiệu đã đóng, không có lỗi lookahead (unit test). Calibration hợp lý. Số tin/ngày trong ngưỡng. |
| **1: Telegram beta kín** | Tối đa 20–50 người được mời. Thêm LLM `veto`. Có lệnh `/stop` và `/quiet`. | Tỷ lệ opt-out < 20%. Tỷ lệ tin bị cooldown chặn hợp lý. Chi phí LLM trong ngân sách. Có ý kiến luật sư. |
| **2: Zalo** | Chỉ khi OA xác thực được và luật sư đồng ý. Tin Tư vấn trong khung 48h/7 ngày, có nút làm mới tương tác. | — |
| 3: Công khai track record | Chỉ sau khi có ý kiến pháp lý. | — |

---

## 14. Câu hỏi mở
1. N18/N21 có cho phép bất kỳ tín hiệu "mua/bán" nào được đẩy chủ động không, kể cả do code sinh ra? Hay chỉ cho "cảnh báo cấu trúc"?
2. LLM có nên tham gia không, hay chạy thuần detector đến khi có đủ dữ liệu calibration?
3. Watchlist và TF ban đầu là gì?
4. Đối tượng: chỉ anh, beta kín, hay công khai? Miễn phí hay thu phí? (Thu phí làm rủi ro pháp lý tăng mạnh.)
5. Có chịu chi phí gói Zalo OA Tăng trưởng (≥ 2,5 triệu/năm) và thủ tục xác thực OA không?
6. Kênh dự phòng nếu Telegram bị chặn lại ở VN: web push hay email?
7. Đơn giá thực tế của agentrouter cho `deepseek-v4-flash` qua OmniRoute là bao nhiêu?

---

## Quyết định cần anh chốt
1. **Mô hình tín hiệu: tất định, LLM chỉ được veto.** *Đề xuất:* đồng ý. Phase 0 tắt LLM hoàn toàn. Phase 1 bật `veto`. Chỉ cho `confirm` cộng điểm khi dữ liệu chứng minh.
2. **Cách diễn đạt:** "cảnh báo cấu trúc / xu hướng" hay "MUA/BÁN"? *Đề xuất:* "cảnh báo cấu trúc", kèm vô hiệu và mốc theo dõi, không dùng từ "mua/bán". Cách này hợp với N18/N21 và giảm rủi ro pháp lý.
3. **Bộ lập lịch:** *Đề xuất:* APScheduler 3.11.x trong service systemd riêng `cryptosignal-autoscan`, hàng đợi bằng bảng SQLite. Dự phòng bằng systemd timer nếu RAM 1 GB không đủ.
4. **Tần suất và TF mặc định:** *Đề xuất:* quét mỗi 1h, TF {1h, 4h}, 10 symbol thanh khoản cao. Cooldown 6 nến (1h) / 3 nến (4h). Giờ yên lặng 23:00–07:00 ICT. Tối đa 6 tin/ngày/người.
5. **Kênh:** *Đề xuất:* chỉ Telegram cho Phase 0–1 (long polling). Zalo Tin Tư vấn để Phase 2 có điều kiện. **Không dùng ZBS/ZNS.**
6. **Ngân sách LLM:** *Đề xuất:* trần 100 lượt/ngày, bỏ qua khi state không đổi, ghim `agentrouter/deepseek-v4-flash`, `reasoning_effort=low`. Ước tính ~$3–26/tháng theo giá tham chiếu (giả định).
7. **Phạm vi người dùng và pháp lý:** *Đề xuất:* chỉ nội bộ và beta kín mời đích danh, miễn phí, không link sàn. **Xin ý kiến luật sư trước Phase 2 và trước khi công khai track record.**
8. **Track record:** *Đề xuất:* ghi ngay từ Phase 0, kể cả tín hiệu thua và tín hiệu ở chế độ shadow. Chỉ hiển thị công khai sau khi có ý kiến pháp lý.

---

## Nguồn tham khảo
(Truy cập trong tháng 10/2026)

**Repo**
- `apps/copilot/src/cryptosignal_copilot/{app.py, klines.py, analyze_prep.py, chart_regime.py, candidates.py, drawing_intent.py, analysis_events.py, server_summary.py, drawing_gate.py, pattern_invalidation.py, wire_guardrail.py, symbol_tick.py, rate_limit.py, db/engine.py, db/models.py}`
- `apps/web/lib/binance.ts`
- `docs/CHART_AI_SPEC.md` §6.2
- `docs/MODEL_SELECTION_SPEC.md` §2
- `docs/OMNIROUTE_CONFIG.md`

**Telegram**
- Telegram Bot FAQ (giới hạn gửi, broadcast, webhook): https://core.telegram.org/bots/faq
- Telegram Bot API (`sendMessage`, `getUpdates`, `setWebhook`): https://core.telegram.org/bots/api
- Telegram Bot Developer Terms: https://telegram.org/tos/bot-developers
- OONI, Telegram bị chặn tại Việt Nam 2025: https://explorer.ooni.org/findings/2025-vietnam-blocked-telegram

**Zalo**
- Zalo OA, Tin Tư vấn: https://oa.zalo.me/home/documents/guides/tin-tu-van
- Zalo Platforms, tài liệu API gửi tin tư vấn: https://docs.zaloplatforms.com (mục OA → Tin Tư vấn)
- Zalo OA, chính sách gửi các loại tin (trang có id `_1433049880779375099`): https://oa.zalo.me
- Bảng giá gói dịch vụ OA từ 1/6/2026: https://zalo.solutions/oa/pricing ; https://oa.zalo.me/home/resources/news/chinh-thuc-quyen-loi-va-bieu-phi-cac-goi-dich-vu-zalo-oa-moi-tu-162026-_5100578039811031184
- Giới hạn tốc độ API: https://docs.zaloplatforms.com/docs/OA/phu-luc/gioi-han-toc-do-api
- OAuth token (access token 25 giờ, refresh token 3 tháng, dùng một lần): https://docs.zaloplatforms.com/docs/OA/bat-dau/xac-thuc-va-uy-quyen-cho-ung-dung-new
- Xác thực OA (Cách 3, 14 ngày), khóa OA (180 ngày), chính sách Extension: các trang hướng dẫn tại https://oa.zalo.me/home/documents/guides
- ZBS Template Message (ra mắt, đơn giá, quy định kiểm duyệt mẫu, cơ chế tính giá): https://zalo.solutions (mục tin tức và hướng dẫn ZBS) ; https://zalo.cloud/blog

**Pháp lý**
- Luật 71/2025/QH15: https://mst.gov.vn/van-ban-phap-luat/25224.htm
- Nghị quyết 05/2025/NQ-CP (toàn văn): https://xaydungchinhsach.chinhphu.vn (bài 119250909184045221)
- Nghị định 284/2026/NĐ-CP: https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-284-2026-nd-cp-470114.htm ; Điều 7: https://hethongphapluat.com (trang Điều 7 NĐ 284/2026) ; thuvienphapluat.vn
- Tình trạng cấp phép CASP: https://thanhnien.vn/khi-nao-viet-nam-co-san-giao-dich-tai-san-ma-hoa-dau-tien-185261023063623604.htm ; vneconomy.vn ; vietstock.vn

**Hạ tầng**
- Binance market-data-only endpoints: https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md
- APScheduler (3.11.x ổn định, 4.0 pre-release): https://pypi.org/project/APScheduler/ ; https://apscheduler.readthedocs.io
- Giá tham chiếu DeepSeek-V4-Flash serverless: https://www.vultr.com/pricing/

**Chưa xác minh**
- Đơn giá agentrouter.
- Mặc định của APScheduler.
- Mâu thuẫn chính sách 48h của Zalo ("8 tin miễn phí" so với "không giới hạn").
- Tình trạng Telegram tại VN 10/2026 (mới xác minh một phần).
- Danh sách cấm crypto của Zalo theo tổng hợp NXLink (nguồn không chính thức).
- Cách hiểu "dịch vụ liên quan đến tài sản mã hóa".
