export const btcAggTradeCombinedStream = {
  stream: "btcusdt@aggTrade",
  data: {
    e: "aggTrade",
    E: 1787369400123,
    s: "BTCUSDT",
    a: 123456789,
    p: "112345.67000000",
    q: "0.01840000",
    f: 987654321,
    l: 987654323,
    T: 1787369400119,
    m: false,
    M: true,
  },
} as const;

export const ethBookTickerCombinedStream = {
  stream: "ethusdt@bookTicker",
  data: {
    u: 543210987,
    s: "ETHUSDT",
    b: "3542.12000000",
    B: "5.81000000",
    a: "3542.13000000",
    A: "4.27000000",
  },
} as const;

export const bnbOpenThirtyMinuteKlineCombinedStream = {
  stream: "bnbusdt@kline_30m",
  data: {
    e: "kline",
    E: 1787369400456,
    s: "BNBUSDT",
    k: {
      t: 1787367600000,
      T: 1787369399999,
      s: "BNBUSDT",
      i: "30m",
      f: 12004567,
      L: 12009123,
      o: "745.12000000",
      c: "746.01000000",
      h: "746.40000000",
      l: "744.88000000",
      v: "1398.42000000",
      n: 4557,
      x: false,
      q: "1043312.98000000",
      V: "712.99000000",
      Q: "531894.12000000",
      B: "0",
    },
  },
} as const;
