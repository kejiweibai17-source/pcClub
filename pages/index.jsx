"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Head from "next/head";
import {
  fetchPickleballSchedule,
  todayDateStrTaipei,
  isBookingFullyPast,
  isSlotStartPast,
  PICKLEBALL_VENUE,
  parseHmToMinutes,
  minutesToHm,
} from "@/lib/pickleballMock";
/**
 * 視覺參考：WordPress Amelia Booking
 * - 淺底白卡、藍主色、月曆格選取態、時段列表卡片、圓角 CTA
 */

const LINE_URL = "https://lin.ee/CBEfgA3";
/** LINE 官方帳號 Basic ID（供 oaMessage 預填預約文字） */
const LINE_OA_ID = "@134njeez";

const COURTS = ["A", "B"];
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
/** 可預約天數：今天起往後 N 天（含今天） */
const BOOKING_WINDOW_DAYS = 30;
/** 每個可選時段長度（分鐘）— 1 小時 */
const SLOT_DURATION = 60;
/** 時段起始間隔（分鐘）— 含半點（:00 / :30） */
const SLOT_STEP = 30;

/** Amelia-like tokens */
const AM = {
  primary: "#1A86F0",
  primaryDark: "#0F6FD6",
  primarySoft: "#E8F3FE",
  primaryText: "#1250A8",
  pageBg: "#F4F7FB",
  card: "#FFFFFF",
  border: "#E6ECF3",
  muted: "#8B96A5",
  text: "#1F2A37",
  success: "#1DBF73",
  successSoft: "#E8FBF2",
  warn: "#F5A524",
  warnSoft: "#FFF6E5",
  dangerSoft: "#FDECEC",
};

const OPEN_MIN = PICKLEBALL_VENUE.openMinutes;
const CLOSE_MIN = PICKLEBALL_VENUE.closeMinutes;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function parseHm(hm) {
  return parseHmToMinutes(hm);
}

/** 營業時段內全部可選 1 小時格（每半小時起始：06:00、06:30…） */
function buildAllDaySlots() {
  const slots = [];
  for (
    let start = OPEN_MIN;
    start + SLOT_DURATION <= CLOSE_MIN;
    start += SLOT_STEP
  ) {
    const end = start + SLOT_DURATION;
    slots.push({
      startMin: start,
      endMin: end,
      start: minutesToHm(start),
      end: minutesToHm(end),
      key: `${minutesToHm(start)}-${minutesToHm(end)}`,
    });
  }
  return slots;
}

const ALL_DAY_SLOTS = buildAllDaySlots();

/**
 * Amelia 風格衝突：服務時長佔用場地整段時間；
 * 候選格只要與已預約區間有交集 → 不可預約。
 * 例：已約 09:30–10:30 → 09:00–10:00、09:30–10:30、10:00–11:00 皆不可約。
 */
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * 將全日時段對上該場預約：available | booked | blocked | past
 * @param {string} dateStr YYYY-MM-DD
 * @param {Date} [now]
 */
function mapSlotsWithBookings(bookings, dateStr, now = new Date()) {
  const active = (bookings || []).filter((b) => b.status !== "cancelled");
  return ALL_DAY_SLOTS.map((slot) => {
    if (isSlotStartPast(dateStr, slot.startMin, now)) {
      return {
        ...slot,
        state: "past",
        booking: null,
        overlapOnly: false,
      };
    }
    const hit = active.find((b) =>
      rangesOverlap(
        slot.startMin,
        slot.endMin,
        parseHm(b.start),
        parseHm(b.end),
      ),
    );
    if (!hit) {
      return { ...slot, state: "available", booking: null, overlapOnly: false };
    }
    const bStart = parseHm(hit.start);
    const bEnd = parseHm(hit.end);
    // 起始／長度與候選格不完全一致但時間重疊 → 仍標佔用（不重複列顯示）
    const overlapOnly = slot.startMin !== bStart || slot.endMin !== bEnd;
    return {
      ...slot,
      state: hit.status === "blocked" ? "blocked" : "booked",
      booking: hit,
      overlapOnly,
    };
  });
}

function monthLabel(year, month) {
  return `${year}年 ${month}月`;
}

function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = String(dateStr || "")
    .split("-")
    .map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function shiftMonth(year, month1to12, delta) {
  const d = new Date(year, month1to12 - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** 列出 minDate～maxDate 涵蓋的年月（含兩端） */
function listMonthsInRange(minDate, maxDate) {
  const [y1, m1] = minDate.split("-").map(Number);
  const [y2, m2] = maxDate.split("-").map(Number);
  const out = [];
  let y = y1;
  let m = m1;
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push({ year: y, month: m });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function cmpMonth(a, b) {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

function formatLongDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${y}年${m}月${d}日（${WEEKDAYS[dt.getDay()]}）`;
}

/** 開啟官方 LINE 對話並預填預約訊息 */
function buildLineBookingUrl({ date, court, start, end }) {
  const text = `嗨！我想預約 ${formatLongDate(date)} ${court}場 ${start}–${end} 時段`;
  return `https://line.me/R/oaMessage/${encodeURIComponent(LINE_OA_ID)}/?${encodeURIComponent(text)}`;
}

function buildMonthGrid(year, month) {
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDow = first.getDay();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, date: `${year}-${pad2(month)}-${pad2(day)}` });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function summarizeDay(bookingsByCourt, dateStr, now = new Date()) {
  const bookedCourts = [];
  const freeCourts = [];
  let hasBlocked = false;
  let hasAnyAvailable = false;

  for (const court of COURTS) {
    const list = bookingsByCourt[court] || [];
    const slots = mapSlotsWithBookings(list, dateStr, now);
    const freeCount = slots.filter((s) => s.state === "available").length;
    const active = list.filter(
      (b) => b.status !== "cancelled" && !isBookingFullyPast(b, now),
    );

    if (freeCount > 0) {
      freeCourts.push(court);
      hasAnyAvailable = true;
    }
    if (active.length > 0) {
      bookedCourts.push(court);
      if (active.some((b) => b.status === "blocked")) hasBlocked = true;
    }
  }

  // 可預約：任一場任一空檔；不可預約：兩場全日時段皆無空檔
  let tone = "free";
  if (!hasAnyAvailable) {
    tone = hasBlocked ? "blocked" : "full";
  } else if (bookedCourts.length > 0) {
    tone = "partial";
  }

  return {
    tone,
    dayBookable: hasAnyAvailable,
    bookedCount: bookedCourts.length,
    bookedCourts,
    freeCourts,
    hasBlocked,
  };
}

function Chevron({ dir = "left" }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      className={dir === "right" ? "rotate-180" : ""}
      aria-hidden
    >
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function TestPickleballPage() {
  const now = useMemo(() => new Date(), []);
  const initialToday = useMemo(() => todayDateStrTaipei(now), [now]);
  const [y0, m0] = useMemo(
    () => initialToday.split("-").map(Number),
    [initialToday],
  );
  const [viewYear, setViewYear] = useState(y0);
  const [viewMonth, setViewMonth] = useState(m0);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(() => new Date());
  const [popupDate, setPopupDate] = useState(null);
  const [popupCourt, setPopupCourt] = useState("A");
  const [selectedSlotKey, setSelectedSlotKey] = useState(null);
  /** 日曆篩選（可複選） */
  const [filterAvailable, setFilterAvailable] = useState(true);
  const [filterFull, setFilterFull] = useState(true);

  const todayStr = todayDateStrTaipei(tick);
  const maxDateStr = useMemo(
    () => addDaysToDateStr(todayStr, BOOKING_WINDOW_DAYS),
    [todayStr],
  );
  const minMonth = useMemo(() => {
    const [y, m] = todayStr.split("-").map(Number);
    return { year: y, month: m };
  }, [todayStr]);
  const maxMonth = useMemo(() => {
    const [y, m] = maxDateStr.split("-").map(Number);
    return { year: y, month: m };
  }, [maxDateStr]);

  const canPrev = cmpMonth({ year: viewYear, month: viewMonth }, minMonth) > 0;
  const canNext = cmpMonth({ year: viewYear, month: viewMonth }, maxMonth) < 0;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const today = todayDateStrTaipei(new Date());
      const maxDate = addDaysToDateStr(today, BOOKING_WINDOW_DAYS);
      const months = listMonthsInRange(today, maxDate);
      const results = await Promise.all(
        months.map(({ year, month }) =>
          fetchPickleballSchedule({ year, month }).catch(() => null),
        ),
      );
      const bookings = [];
      const seen = new Set();
      for (const r of results) {
        for (const b of r?.bookings || []) {
          if (!b?.date || b.date < today || b.date > maxDate) continue;
          const key = `${b.date}|${b.court}|${b.start}|${b.end}|${b.status}|${b.name || ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          bookings.push(b);
        }
      }
      setPayload({
        venue: results.find((r) => r?.venue)?.venue || PICKLEBALL_VENUE,
        bookings,
        source: results.find((r) => r)?.source || "sheets",
        fetchedAt: new Date().toISOString(),
        minDate: today,
        maxDate,
      });
      setTick(new Date());
    } catch {
      // 錯誤不顯示於頁面（例如缺少當月分頁）
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setTick(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // 若今天跨月，把檢視月夾回可預約範圍
    if (cmpMonth({ year: viewYear, month: viewMonth }, minMonth) < 0) {
      setViewYear(minMonth.year);
      setViewMonth(minMonth.month);
    } else if (cmpMonth({ year: viewYear, month: viewMonth }, maxMonth) > 0) {
      setViewYear(maxMonth.year);
      setViewMonth(maxMonth.month);
    }
  }, [viewYear, viewMonth, minMonth, maxMonth]);

  useEffect(() => {
    if (!popupDate) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setPopupDate(null);
        setSelectedSlotKey(null);
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [popupDate]);

  const byDateCourt = useMemo(() => {
    const map = {};
    (payload?.bookings || []).forEach((b) => {
      // 前端雙重保險：過期日／當日已結束時段不進日曆／彈窗
      if (!b?.date || isBookingFullyPast(b, tick)) return;
      if (b.date > maxDateStr) return;
      if (!map[b.date]) map[b.date] = { A: [], B: [] };
      if (map[b.date][b.court]) map[b.date][b.court].push(b);
    });
    Object.values(map).forEach((courts) => {
      COURTS.forEach((c) =>
        courts[c].sort((a, b) => parseHm(a.start) - parseHm(b.start)),
      );
    });
    return map;
  }, [payload, tick, maxDateStr]);

  const grid = useMemo(
    () => buildMonthGrid(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  const goMonth = (delta) => {
    const next = shiftMonth(viewYear, viewMonth, delta);
    if (cmpMonth(next, minMonth) < 0 || cmpMonth(next, maxMonth) > 0) return;
    setViewYear(next.year);
    setViewMonth(next.month);
  };

  const openDayPopup = (date) => {
    if (date < todayStr || date > maxDateStr) return;
    const courts = byDateCourt[date] || { A: [], B: [] };
    const summary = summarizeDay(courts, date, tick);
    if (!summary.dayBookable) return;
    setPopupCourt(summary.freeCourts[0] || "A");
    setSelectedSlotKey(null);
    setPopupDate(date);
  };

  const popupCourts = popupDate
    ? byDateCourt[popupDate] || { A: [], B: [] }
    : { A: [], B: [] };
  const popupSummary = popupDate
    ? summarizeDay(popupCourts, popupDate, tick)
    : null;

  useEffect(() => {
    if (popupDate && (popupDate < todayStr || popupDate > maxDateStr)) {
      setPopupDate(null);
      setSelectedSlotKey(null);
    }
  }, [popupDate, todayStr, maxDateStr]);

  const activeCourtSlots = useMemo(() => {
    if (!popupDate) return [];
    const courts = byDateCourt[popupDate] || { A: [], B: [] };
    return mapSlotsWithBookings(courts[popupCourt] || [], popupDate, tick);
  }, [popupDate, popupCourt, byDateCourt, tick]);

  /** 只顯示仍可預約的時段；過期／已預約／關閉皆不列於畫面 */
  const visibleCourtSlots = useMemo(
    () => activeCourtSlots.filter((s) => s.state === "available"),
    [activeCourtSlots],
  );

  const selectedSlot = visibleCourtSlots.find(
    (s) => s.key === selectedSlotKey && s.state === "available",
  );

  const closePopup = () => {
    setPopupDate(null);
    setSelectedSlotKey(null);
  };

  const switchPopupCourt = (court) => {
    setPopupCourt(court);
    setSelectedSlotKey(null);
  };

  const availableCount = visibleCourtSlots.filter(
    (s) => s.state === "available",
  ).length;

  return (
    <>
      <Head>
        <title>匹克球場預約狀態</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+TC:wght@400;500;700;900&display=swap"
          rel="stylesheet"
        />
      </Head>

      <div
        className="min-h-screen"
        style={{
          fontFamily: '"Inter", "Noto Sans TC", system-ui, sans-serif',
          background: AM.pageBg,
          color: AM.text,
        }}
      >
        <div className="max-w-[720px] mx-auto px-4 sm:px-6 py-8 sm:py-10">
          {/* Amelia-style top badge */}

          {/* Service header card（類似 Amelia 服務標題區） */}
          <div
            className="rounded-none bg-white border px-5 py-5 sm:px-6 sm:py-6 mb-5"
            style={{
              borderColor: AM.border,
              boxShadow: "0 8px 30px rgba(31,42,55,0.06)",
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-[28px] font-extrabold tracking-tight text-[#1F2A37]">
                  {payload?.venue?.name || "匹克球場"}預約
                </h1>
                <p className="mt-2 text-sm text-[#8B96A5] leading-relaxed">
                  營業 {PICKLEBALL_VENUE.openLabel}–
                  {PICKLEBALL_VENUE.closeLabel}
                  （半點可約、時長 1 小時）· 可約今日起 {BOOKING_WINDOW_DAYS}{" "}
                  天內 · A／B 兩場
                </p>
              </div>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="shrink-0 rounded-none px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                style={{ background: AM.primary }}
              >
                {loading ? "載入中" : "重新整理"}
              </button>
            </div>
          </div>

          {/* Legend 勾選篩選 */}
          <div
            className="inline-flex flex-wrap items-center gap-1 p-1 mb-4"
            style={{ background: "#EEF3F8" }}
            role="group"
            aria-label="日曆篩選"
          >
            <FilterCheck
              checked={filterAvailable}
              onChange={setFilterAvailable}
              label="可預約"
              activeColor={AM.primary}
              swatch={AM.primarySoft}
              swatchBorder={AM.primary}
            />
            <FilterCheck
              checked={filterFull}
              onChange={setFilterFull}
              label="已滿"
              activeColor="#98A2AE"
              swatch="#F0F2F5"
              swatchBorder="#E4E8ED"
            />
          </div>

          {/* Calendar card（Amelia month calendar） */}
          <section
            className="rounded-none bg-white border overflow-hidden"
            style={{
              borderColor: AM.border,
              boxShadow: "0 10px 40px rgba(31,42,55,0.07)",
            }}
          >
            {/* Month toolbar — 可預約範圍內切換月份 */}
            <div
              className="flex items-center justify-between gap-2 px-3 sm:px-5 py-3.5 border-b"
              style={{ borderColor: AM.border }}
            >
              <button
                type="button"
                disabled={!canPrev}
                onClick={() => goMonth(-1)}
                className="w-10 h-10 rounded-none flex items-center justify-center text-[#5B6B7C] hover:bg-[#F4F7FB] disabled:opacity-25"
                aria-label="上月"
              >
                <Chevron dir="left" />
              </button>
              <h2 className="text-lg sm:text-xl font-extrabold text-[#1F2A37] tabular-nums">
                {monthLabel(viewYear, viewMonth)}
              </h2>
              <button
                type="button"
                disabled={!canNext}
                onClick={() => goMonth(1)}
                className="w-10 h-10 rounded-none flex items-center justify-center text-[#5B6B7C] hover:bg-[#F4F7FB] disabled:opacity-25"
                aria-label="下月"
              >
                <Chevron dir="right" />
              </button>
            </div>

            <div className="p-3 sm:p-5">
              <div className="grid grid-cols-7 mb-2">
                {WEEKDAYS.map((w) => (
                  <div
                    key={w}
                    className="text-center text-[11px] sm:text-xs font-bold py-2"
                    style={{ color: AM.muted }}
                  >
                    {w}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {grid.map((cell, idx) => {
                  if (!cell) {
                    return (
                      <div
                        key={`e-${idx}`}
                        className="aspect-square rounded-none bg-transparent"
                      />
                    );
                  }
                  const courts = byDateCourt[cell.date] || { A: [], B: [] };
                  const summary = summarizeDay(courts, cell.date, tick);
                  const isToday = cell.date === todayStr;
                  const isPast = cell.date < todayStr;
                  const isOutOfRange = cell.date > maxDateStr;
                  const isClosedDay = isPast || isOutOfRange;
                  const isSelected = popupDate === cell.date;
                  const dayBookable = !isClosedDay && summary.dayBookable;
                  const isFull = !isClosedDay && !dayBookable;

                  // 過期／超出可約範圍一律顯示（反白不可點）；其餘依篩選
                  const showByFilter =
                    (dayBookable && filterAvailable) || (isFull && filterFull);
                  const visible =
                    isClosedDay ||
                    (!filterAvailable && !filterFull) ||
                    showByFilter;

                  if (!visible) {
                    return (
                      <div
                        key={cell.date}
                        className="aspect-square rounded-none border border-dashed"
                        style={{
                          borderColor: "#E4E8ED",
                          background: "#FAFBFC",
                        }}
                        aria-hidden
                      />
                    );
                  }

                  let bg = AM.primarySoft;
                  let border = "#C9E2FC";
                  let color = AM.primaryText;
                  let label = "可預約";

                  if (isPast) {
                    bg = "#EEF0F3";
                    border = "#E2E5EA";
                    color = "#A8B0BA";
                    label = "已過期";
                  } else if (isOutOfRange) {
                    bg = "#EEF0F3";
                    border = "#E2E5EA";
                    color = "#A8B0BA";
                    label = "不可約";
                  } else if (isFull) {
                    bg = "#F0F2F5";
                    border = "#E4E8ED";
                    color = "#B0B8C2";
                    label = "已滿";
                  }

                  if (isSelected && dayBookable) {
                    bg = AM.primary;
                    border = AM.primary;
                    color = "#FFFFFF";
                  }

                  return (
                    <button
                      key={cell.date}
                      type="button"
                      disabled={isClosedDay || isFull}
                      aria-disabled={isClosedDay || isFull}
                      onClick={() => dayBookable && openDayPopup(cell.date)}
                      className="aspect-square rounded-none border text-left p-1 sm:p-2 flex flex-col transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:hover:brightness-100 hover:brightness-[0.98]"
                      style={{
                        background: bg,
                        borderColor: border,
                        color,
                        opacity: isClosedDay || isFull ? 0.4 : 1,
                        filter:
                          isClosedDay || isFull
                            ? "grayscale(0.95)"
                            : undefined,
                        boxShadow:
                          isToday && !isSelected
                            ? `inset 0 0 0 2px ${AM.primary}`
                            : undefined,
                      }}
                    >
                      <span className="text-[11px] sm:text-sm font-bold tabular-nums leading-none">
                        {cell.day}
                      </span>
                      <div className="mt-auto">
                        <span
                          className="block text-[8px] sm:text-[10px] font-bold leading-tight"
                          style={{ opacity: isSelected ? 0.95 : 1 }}
                        >
                          {label}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Contact strip */}
          <div
            className="mt-6 rounded-none bg-white border px-5 py-5 text-center"
            style={{ borderColor: AM.border }}
          >
            <p className="text-sm text-[#5B6B7C] leading-relaxed">
              上方日曆為球場預約狀態參考。若要預約或確認空場，請透過 LINE
              聯繫。
            </p>
            <div className="mt-4 flex flex-col sm:flex-row items-center justify-center gap-2.5">
              <a
                href={LINE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-none px-5 py-3 text-sm font-bold text-white"
                style={{ background: "#06C755" }}
              >
                官方 LINE 預約
              </a>
            </div>
          </div>
        </div>

        {/* Amelia-like day detail popup */}
        <AnimatePresence>
          {popupDate && popupSummary && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-[#1F2A37]/45 backdrop-blur-[2px]"
                onClick={closePopup}
              />
              <motion.div
                role="dialog"
                aria-modal="true"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="fixed z-50 inset-x-0 bottom-0 sm:inset-x-auto sm:bottom-auto sm:top-[6%] sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-[440px]"
              >
                <div
                  className="bg-white rounded-none overflow-hidden flex flex-col h-[min(92dvh,92vh)] sm:h-auto sm:max-h-[88vh]"
                  style={{ boxShadow: "0 24px 80px rgba(31,42,55,0.28)" }}
                >
                  <div
                    className="px-4 sm:px-5 pt-4 sm:pt-5 pb-3 border-b shrink-0"
                    style={{ borderColor: AM.border }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 pr-2">
                        <h3 className="text-lg sm:text-xl font-extrabold text-[#1F2A37] leading-snug">
                          {formatLongDate(popupDate)}
                        </h3>
                        <p className="text-[11px] sm:text-xs text-[#8B96A5] mt-1 leading-relaxed">
                          {PICKLEBALL_VENUE.openLabel}–
                          {PICKLEBALL_VENUE.closeLabel}
                          <span className="mx-1">·</span>
                          每格 1 小時
                          <span className="mx-1">·</span>
                          半點可約
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={closePopup}
                        className="shrink-0 w-9 h-9 rounded-none bg-[#F4F7FB] text-[#8B96A5] hover:bg-[#E8EEF5] text-lg font-bold leading-none"
                        aria-label="關閉"
                      >
                        ×
                      </button>
                    </div>

                    {/* A / B 場切換 */}
                    <div
                      className="mt-3 sm:mt-4 grid grid-cols-2 gap-0 border"
                      style={{ borderColor: AM.border, background: "#EEF3F8" }}
                      role="tablist"
                      aria-label="選擇球場"
                    >
                      {COURTS.map((c, i) => {
                        const active = popupCourt === c;
                        const courtSlots = mapSlotsWithBookings(
                          popupCourts[c] || [],
                          popupDate,
                          tick,
                        );
                        const freeN = courtSlots.filter(
                          (s) => s.state === "available",
                        ).length;
                        return (
                          <button
                            key={c}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => switchPopupCourt(c)}
                            className="rounded-none px-2 sm:px-3 py-3 text-center transition-colors min-h-[64px] flex flex-col items-center justify-center"
                            style={{
                              background: active ? "#FFFFFF" : "transparent",
                              borderRight:
                                i === 0 ? `1px solid ${AM.border}` : "none",
                              boxShadow: active
                                ? `inset 0 -2px 0 ${AM.primary}`
                                : "none",
                              color: active ? AM.primaryText : AM.muted,
                            }}
                          >
                            <span className="block text-sm font-extrabold leading-none">
                              {c} 場
                            </span>
                            <span
                              className="block text-[10px] font-bold mt-1.5 leading-none whitespace-nowrap"
                              style={{
                                color: freeN ? AM.success : AM.muted,
                              }}
                            >
                              {freeN ? `${freeN} 個時段可約` : "已滿"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="px-4 sm:px-5 py-3 overflow-y-auto flex-1 min-h-0 overscroll-contain">
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <p className="text-sm font-extrabold text-[#1F2A37] shrink-0">
                        {popupCourt} 場時段
                      </p>
                      <span className="text-[11px] font-bold text-[#8B96A5] tabular-nums shrink-0">
                        可約 {availableCount} 時段
                      </span>
                    </div>

                    <div
                      className="space-y-0 border-t"
                      style={{ borderColor: AM.border }}
                    >
                      {visibleCourtSlots.length === 0 ? (
                        <p className="text-center text-sm text-[#8B96A5] py-8">
                          目前無可預約時段
                        </p>
                      ) : (
                        visibleCourtSlots.map((slot) => {
                          const isSelected = selectedSlotKey === slot.key;

                          return (
                            <button
                              key={slot.key}
                              type="button"
                              onClick={() => setSelectedSlotKey(slot.key)}
                              className="w-full rounded-none border-x border-b px-3 py-3 grid grid-cols-[1fr_auto] items-center gap-3 text-left transition-colors"
                              style={{
                                borderColor: isSelected
                                  ? AM.primary
                                  : AM.border,
                                background: isSelected
                                  ? AM.primarySoft
                                  : "#FFFFFF",
                              }}
                            >
                              <div className="min-w-0">
                                <p
                                  className="text-[15px] font-extrabold tabular-nums leading-none tracking-tight"
                                  style={{ color: AM.text }}
                                >
                                  {slot.start}
                                  <span className="text-[#C0C8D2] mx-1">–</span>
                                  {slot.end}
                                </p>
                              </div>
                              <span
                                className="shrink-0 w-[52px] sm:w-[56px] text-center text-[10px] font-extrabold px-0 py-1.5 rounded-none leading-none"
                                style={{
                                  background: isSelected
                                    ? AM.primary
                                    : AM.successSoft,
                                  color: isSelected ? "#FFFFFF" : "#0F8A52",
                                }}
                              >
                                可預約
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div
                    className="px-4 sm:px-5 py-3 sm:py-4 border-t space-y-2 shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
                    style={{ borderColor: AM.border }}
                  >
                    {selectedSlot ? (
                      <>
                        <p className="text-center text-xs text-[#5B6B7C] mb-1">
                          已選 {popupCourt} 場 · {selectedSlot.start}–
                          {selectedSlot.end}
                        </p>
                        <a
                          href={buildLineBookingUrl({
                            date: popupDate,
                            court: popupCourt,
                            start: selectedSlot.start,
                            end: selectedSlot.end,
                          })}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex w-full items-center justify-center rounded-none px-4 py-3.5 text-sm font-extrabold text-white"
                          style={{ background: AM.primary }}
                        >
                          立即預約
                        </a>
                      </>
                    ) : (
                      <p className="text-center text-sm text-[#8B96A5] py-2">
                        {availableCount
                          ? "請點選可預約時段"
                          : `${popupCourt} 場當日已無可約時段，可切換另一場`}
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}

function FilterCheck({
  checked,
  onChange,
  label,
  activeColor,
  swatch,
  swatchBorder,
}) {
  return (
    <label
      className="inline-flex items-center gap-2 cursor-pointer select-none px-3 py-2 text-xs font-bold transition-colors"
      style={{
        background: checked ? "#FFFFFF" : "transparent",
        color: checked ? AM.text : AM.muted,
        boxShadow: checked ? "0 1px 3px rgba(31,42,55,0.08)" : "none",
      }}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        className="w-3.5 h-3.5 rounded-none border flex items-center justify-center shrink-0"
        style={{
          borderColor: checked ? activeColor : "#C5CCD4",
          background: checked ? activeColor : "#FFFFFF",
        }}
        aria-hidden
      >
        {checked ? (
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <path
              d="M2.5 6.2L4.8 8.5L9.5 3.5"
              stroke="#fff"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
      <span
        className="w-3 h-3 rounded-none border shrink-0"
        style={{ background: swatch, borderColor: swatchBorder }}
        aria-hidden
      />
      {label}
    </label>
  );
}
