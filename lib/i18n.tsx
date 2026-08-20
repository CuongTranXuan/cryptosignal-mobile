import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";

export type AppLocale = "en" | "vi";

type TemplateValues = Record<string, string | number>;

const translations = {
  en: {
    languageEnglish: "English",
    languageVietnamese: "Tiếng Việt",
    language: "Language",
    demoResearchAccess: "Demo research access",
    loginDescription: "Use the default demo account to open the web research dashboard. Telegram is an optional integration for shared controls and eligible alerts.",
    username: "Username",
    password: "Password",
    openDemoDashboard: "Open demo dashboard",
    signingIn: "Opening dashboard…",
    demoCredentials: "Demo credentials: user / password. No exchange credentials or trading actions are available here.",
    unableToSignIn: "Unable to sign in.",
    signedInAs: "Signed in as {username}",
    webControl: "WEB CONTROL",
    signOut: "Sign out",
    openTelegram: "Open Telegram",
    telegramUnavailable: "Telegram unavailable",
    researchEyebrow: "CLOSED-CANDLE MARKET RESEARCH",
    researchTitle: "Signals, conditional outlooks, and web-native operational controls.",
    researchSubtitle: "The dashboard can be tested independently. Telegram is optional and shares this versioned configuration only when enabled. Every scenario remains signals-only research based on completed OHLCV candles.",
    monitoringClosed: "Monitoring completed candles",
    paused: "Signal processing paused",
    noExecution: "NO EXECUTION",
    historicalEvidence: "Historical price & signal evidence",
    historicalEvidenceSubtitle: "Pan, zoom, use the crosshair, and inspect completed candles and persisted annotations.",
    refreshLatest: "Refresh latest closed candles",
    refreshLatestHelp: "Fetches public Binance closed candles, recalculates research evidence, and saves chart history. No exchange credentials or orders are used.",
    refreshNow: "Refresh & calculate",
    refreshInProgress: "Refreshing public closed-candle data…",
    refreshCompleted: "Refresh completed: {cycles} market windows calculated from public closed candles.",
    refreshFailed: "Public candle refresh could not finish. Check the runner health panel and try again.",
    noChartHistory: "No chart history",
    noChartHistoryDetail: "Refresh public closed candles to populate this pair and timeframe.",
    conditionalOutlook: "Conditional research outlook",
    conditionalOutlookSubtitle: "Conditions, evidence, and invalidation—not price targets or personal recommendations.",
    invalidation: "Invalidation: {value}",
    observedBand: "Observed volatility band: {lower}–{upper}",
    signalControls: "Signal controls",
    signalControlsSubtitle: "Changes here affect the web research workflow and the next configured closed-candle cycle. Telegram shares them only when enabled.",
    lastChange: "Last change: {actor} · Telegram {state}",
    active: "ACTIVE",
    pausedState: "PAUSED",
    refresh: "Refresh",
    dismiss: "Dismiss",
    resumeProcessing: "Resume signal processing",
    pauseProcessing: "Pause signal processing",
    watchlist: "Watchlist",
    watchlistHelp: "At least one market remains selected.",
    timeframes: "Timeframes",
    timeframesHelp: "30m, 1h, and 4h use closed candles only.",
    alertThreshold: "Alert threshold · {value}%",
    alertThresholdHelp: "Minimum normalized evidence score before an enabled delivery integration is attempted.",
    alertCooldown: "Alert cooldown",
    alertCooldownHelp: "Minutes before the same signal state can be alerted again.",
    minutes: "min",
    save: "Save",
    ruleFamilies: "Rule families",
    ruleFamiliesHelp: "Enables explainable research evidence families; experimental proxies are clearly labeled.",
    saving: "Saving shared configuration…",
    controlsUnavailable: "Controls unavailable",
    controlsUnavailableDetail: "Configuration could not be loaded. Retry after the API is available.",
    latestSignal: "Latest persisted signal",
    latestSignalSubtitle: "Saved as web research evidence before any optional delivery integration.",
    noSignal: "No signal snapshot",
    noSignalDetail: "Refresh public closed candles to create a completed-candle research result.",
    telegramIntegration: "Optional Telegram integration",
    telegramIntegrationSubtitle: "The web app is fully testable without Telegram. Enable it later to share configuration and deliver eligible alerts.",
    openTelegramIntegration: "Open Telegram integration",
    telegramNotConfigured: "Telegram integration not configured",
    researchBoundary: "Research boundary",
    researchBoundaryDetail: "The dashboard displays historical rule evidence and conditional scenarios. It does not place orders, hold exchange credentials, provide a target price, or issue a personalized recommendation.",
    runnerHealth: "Runner health",
    runnerHealthSubtitle: "Quietly refreshed every 30 seconds from persisted runner data.",
    checks: "{count} checks",
    lastCompleted: "Last completed {time}",
    noCompletedCycle: "No completed cycle reported yet",
    runnerUnavailable: "Runner state is unavailable until the API responds.",
    auditHistory: "Operational audit history",
    auditHistorySubtitle: "Read-only evidence for configuration, engine, delivery, and runner events.",
    noOperationalEvents: "No persisted operational events yet.",
    configSaved: "Shared configuration updated.",
    configSaveError: "The shared configuration could not be saved. Try again.",
    cooldownValidation: "Cooldown must be a whole number from 1 to 1,440 minutes.",
  },
  vi: {
    languageEnglish: "English",
    languageVietnamese: "Tiếng Việt",
    language: "Ngôn ngữ",
    demoResearchAccess: "Truy cập nghiên cứu thử nghiệm",
    loginDescription: "Dùng tài khoản thử nghiệm mặc định để mở bảng điều khiển nghiên cứu trên web. Telegram là tích hợp tùy chọn cho điều khiển dùng chung và cảnh báo đủ điều kiện.",
    username: "Tên đăng nhập",
    password: "Mật khẩu",
    openDemoDashboard: "Mở bảng điều khiển thử nghiệm",
    signingIn: "Đang mở bảng điều khiển…",
    demoCredentials: "Thông tin thử nghiệm: user / password. Không dùng thông tin sàn giao dịch và không có hành động giao dịch.",
    unableToSignIn: "Không thể đăng nhập.",
    signedInAs: "Đã đăng nhập với {username}",
    webControl: "ĐIỀU KHIỂN WEB",
    signOut: "Đăng xuất",
    openTelegram: "Mở Telegram",
    telegramUnavailable: "Telegram chưa khả dụng",
    researchEyebrow: "NGHIÊN CỨU THỊ TRƯỜNG THEO NẾN ĐÃ ĐÓNG",
    researchTitle: "Tín hiệu, kịch bản có điều kiện và điều khiển vận hành trên web.",
    researchSubtitle: "Bảng điều khiển có thể kiểm thử độc lập. Telegram là tùy chọn và chỉ dùng chung cấu hình phiên bản này khi được bật. Mọi kịch bản đều là nghiên cứu tín hiệu dựa trên dữ liệu OHLCV đã hoàn tất.",
    monitoringClosed: "Đang theo dõi nến đã hoàn tất",
    paused: "Đã tạm dừng xử lý tín hiệu",
    noExecution: "KHÔNG THỰC THI",
    historicalEvidence: "Lịch sử giá và bằng chứng tín hiệu",
    historicalEvidenceSubtitle: "Kéo, thu phóng, dùng con trỏ chữ thập và xem các nến đã hoàn tất cùng chú thích đã lưu.",
    refreshLatest: "Làm mới nến đã đóng mới nhất",
    refreshLatestHelp: "Tải nến đã đóng công khai từ Binance, tính lại bằng chứng nghiên cứu và lưu lịch sử biểu đồ. Không dùng thông tin sàn hoặc lệnh giao dịch.",
    refreshNow: "Làm mới và tính toán",
    refreshInProgress: "Đang làm mới dữ liệu nến đã đóng công khai…",
    refreshCompleted: "Đã làm mới: đã tính {cycles} cửa sổ thị trường từ nến đã đóng công khai.",
    refreshFailed: "Không thể hoàn tất làm mới dữ liệu nến công khai. Hãy kiểm tra trạng thái chạy và thử lại.",
    noChartHistory: "Chưa có lịch sử biểu đồ",
    noChartHistoryDetail: "Hãy làm mới nến đã đóng công khai để điền dữ liệu cho cặp và khung thời gian này.",
    conditionalOutlook: "Kịch bản nghiên cứu có điều kiện",
    conditionalOutlookSubtitle: "Điều kiện, bằng chứng và mức vô hiệu hóa — không phải mục tiêu giá hay khuyến nghị cá nhân.",
    invalidation: "Vô hiệu hóa: {value}",
    observedBand: "Biên độ biến động quan sát: {lower}–{upper}",
    signalControls: "Điều khiển tín hiệu",
    signalControlsSubtitle: "Các thay đổi ở đây ảnh hưởng quy trình nghiên cứu web và chu kỳ nến đã đóng tiếp theo. Telegram chỉ dùng chung khi được bật.",
    lastChange: "Lần đổi cuối: {actor} · Telegram {state}",
    active: "ĐANG HOẠT ĐỘNG",
    pausedState: "ĐÃ TẠM DỪNG",
    refresh: "Làm mới",
    dismiss: "Đóng",
    resumeProcessing: "Tiếp tục xử lý tín hiệu",
    pauseProcessing: "Tạm dừng xử lý tín hiệu",
    watchlist: "Danh sách theo dõi",
    watchlistHelp: "Cần chọn ít nhất một thị trường.",
    timeframes: "Khung thời gian",
    timeframesHelp: "30m, 1h và 4h chỉ sử dụng nến đã đóng.",
    alertThreshold: "Ngưỡng cảnh báo · {value}%",
    alertThresholdHelp: "Điểm bằng chứng chuẩn hóa tối thiểu trước khi thử tích hợp gửi cảnh báo đang bật.",
    alertCooldown: "Thời gian chờ cảnh báo",
    alertCooldownHelp: "Số phút trước khi trạng thái tín hiệu giống nhau có thể được cảnh báo lại.",
    minutes: "phút",
    save: "Lưu",
    ruleFamilies: "Nhóm quy tắc",
    ruleFamiliesHelp: "Bật các nhóm bằng chứng nghiên cứu có thể giải thích; các mô phỏng thử nghiệm được gắn nhãn rõ ràng.",
    saving: "Đang lưu cấu hình dùng chung…",
    controlsUnavailable: "Không có điều khiển",
    controlsUnavailableDetail: "Không thể tải cấu hình. Hãy thử lại khi API sẵn sàng.",
    latestSignal: "Tín hiệu đã lưu mới nhất",
    latestSignalSubtitle: "Được lưu như bằng chứng nghiên cứu web trước bất kỳ tích hợp gửi tín hiệu tùy chọn nào.",
    noSignal: "Chưa có bản ghi tín hiệu",
    noSignalDetail: "Hãy làm mới nến đã đóng công khai để tạo kết quả nghiên cứu theo nến hoàn tất.",
    telegramIntegration: "Tích hợp Telegram tùy chọn",
    telegramIntegrationSubtitle: "Ứng dụng web có thể kiểm thử đầy đủ không cần Telegram. Hãy bật sau để dùng chung cấu hình và gửi cảnh báo đủ điều kiện.",
    openTelegramIntegration: "Mở tích hợp Telegram",
    telegramNotConfigured: "Chưa cấu hình tích hợp Telegram",
    researchBoundary: "Giới hạn nghiên cứu",
    researchBoundaryDetail: "Bảng điều khiển hiển thị bằng chứng quy tắc lịch sử và kịch bản có điều kiện. Ứng dụng không đặt lệnh, không lưu thông tin sàn, không đưa ra mục tiêu giá hoặc khuyến nghị cá nhân.",
    runnerHealth: "Tình trạng bộ chạy",
    runnerHealthSubtitle: "Tự động làm mới yên lặng mỗi 30 giây từ dữ liệu bộ chạy đã lưu.",
    checks: "{count} lần kiểm tra",
    lastCompleted: "Hoàn tất lần cuối {time}",
    noCompletedCycle: "Chưa có chu kỳ hoàn tất được ghi nhận",
    runnerUnavailable: "Chưa có trạng thái bộ chạy cho đến khi API phản hồi.",
    auditHistory: "Lịch sử kiểm toán vận hành",
    auditHistorySubtitle: "Bằng chứng chỉ đọc cho cấu hình, bộ máy, phân phối và các sự kiện bộ chạy.",
    noOperationalEvents: "Chưa có sự kiện vận hành được lưu.",
    configSaved: "Đã cập nhật cấu hình dùng chung.",
    configSaveError: "Không thể lưu cấu hình dùng chung. Hãy thử lại.",
    cooldownValidation: "Thời gian chờ phải là số nguyên từ 1 đến 1.440 phút.",
  },
} as const;

export type TranslationKey = keyof typeof translations.en;

type I18nContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: TranslationKey, values?: TemplateValues) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);
const STORAGE_KEY = "cryptosignal.locale";

function format(template: string, values?: TemplateValues) {
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(values?.[name] ?? `{${name}}`));
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>("en");

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "vi") setLocaleState(stored);
  }, []);

  const setLocale = useCallback((nextLocale: AppLocale) => {
    setLocaleState(nextLocale);
    if (Platform.OS === "web") globalThis.localStorage?.setItem(STORAGE_KEY, nextLocale);
  }, []);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key, values) => format(translations[locale][key], values),
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside LanguageProvider");
  return value;
}
