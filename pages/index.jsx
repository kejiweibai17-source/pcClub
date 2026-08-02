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

const LINE_URL = process.env.NEXT_PUBLIC_LINE_OA_URL || "https://lin.ee/y6tdx5q";
const PHONE_DISPLAY = "0925-018-770";
const PHONE_TEL = "tel:+886925018770";

const COURTS = ["A", "B"];
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const FORWARD_MONTHS = 11;
/** 每個可選時段長度（分鐘）— 整點 1 小時 */
const SLOT_DURATION = 60;
/** 時段起始間隔（分鐘）— 僅整點，無半點 */
const SLOT_STEP = 60;

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

/** 營業時段內全部可選 1 小時格（僅整點起始） */
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
 * 例：已約 09:00–10:00 → 09:00–10:00 不可約；緊接的 10:00–11:00 可約（無 buffer）。
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

function maskName(name) {
  const s = String(name || "").trim();
  if (!s) return "—";
  if (s.length <= 1) return s;
  if (s.length === 2) return `${s[0]}○`;
  return `${s[0]}${"○".repeat(Math.min(2, s.length - 2))}${s[s.length - 1]}`;
}

function shiftMonth(year, month1to12, delta) {
  const d = new Date(year, month1to12 - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function monthLabel(year, month) {
  return `${year}年 ${month}月`;
}

function formatLongDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${y}年${m}月${d}日（${WEEKDAYS[dt.getDay()]}）`;
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
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(() => new Date());
  const [popupDate, setPopupDate] = useState(null);
  const [popupCourt, setPopupCourt] = useState("A");
  const [selectedSlotKey, setSelectedSlotKey] = useState(null);
  /** 日曆篩選（可複選） */
  const [filterAvailable, setFilterAvailable] = useState(true);
  const [filterFull, setFilterFull] = useState(true);

  const baseYear = now.getFullYear();
  const baseMonth = now.getMonth() + 1;
  const minM = { year: baseYear, month: baseMonth };
  const maxM = shiftMonth(baseYear, baseMonth, FORWARD_MONTHS);

  const canPrev =
    viewYear > minM.year || (viewYear === minM.year && viewMonth > minM.month);
  const canNext =
    viewYear < maxM.year || (viewYear === maxM.year && viewMonth < maxM.month);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchPickleballSchedule({
        year: viewYear,
        month: viewMonth,
      });
      setPayload(data);
      setTick(new Date());
    } catch (e) {
      setError(e?.message || "載入失敗");
    } finally {
      setLoading(false);
    }
  }, [viewYear, viewMonth]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setTick(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

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

  const todayStr = todayDateStrTaipei(tick);

  const byDateCourt = useMemo(() => {
    const map = {};
    (payload?.bookings || []).forEach((b) => {
      // 前端雙重保險：過期日／當日已結束時段不進日曆／彈窗
      if (!b?.date || isBookingFullyPast(b, tick)) return;
      if (!map[b.date]) map[b.date] = { A: [], B: [] };
      if (map[b.date][b.court]) map[b.date][b.court].push(b);
    });
    Object.values(map).forEach((courts) => {
      COURTS.forEach((c) =>
        courts[c].sort((a, b) => parseHm(a.start) - parseHm(b.start)),
      );
    });
    return map;
  }, [payload, tick]);

  const grid = useMemo(
    () => buildMonthGrid(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  const goMonth = (delta) => {
    const next = shiftMonth(viewYear, viewMonth, delta);
    setViewYear(next.year);
    setViewMonth(next.month);
  };

  const goToday = () => {
    setViewYear(baseYear);
    setViewMonth(baseMonth);
  };

  const openDayPopup = (date) => {
    if (date < todayStr) return;
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
    if (popupDate && popupDate < todayStr) {
      setPopupDate(null);
      setSelectedSlotKey(null);
    }
  }, [popupDate, todayStr]);

  const activeCourtSlots = useMemo(() => {
    if (!popupDate) return [];
    const courts = byDateCourt[popupDate] || { A: [], B: [] };
    return mapSlotsWithBookings(courts[popupCourt] || [], popupDate, tick);
  }, [popupDate, popupCourt, byDateCourt, tick]);

  /** 列表不顯示非整點對齊的重疊衝突格（僅保留可約＋實際預約起始格） */
  const visibleCourtSlots = useMemo(
    () => activeCourtSlots.filter((s) => !s.overlapOnly),
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
                  （整點 1 小時）· A／B 兩場 · 點日期查看時段
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

          {error ? <p className="text-sm text-red-500 mb-4">{error}</p> : null}

          {/* Calendar card（Amelia month calendar） */}
          <section
            className="rounded-none bg-white border overflow-hidden"
            style={{
              borderColor: AM.border,
              boxShadow: "0 10px 40px rgba(31,42,55,0.07)",
            }}
          >
            {/* Month toolbar */}
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
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-extrabold text-[#1F2A37] tabular-nums">
                  {monthLabel(viewYear, viewMonth)}
                </h2>
                <button
                  type="button"
                  onClick={goToday}
                  className="hidden sm:inline-flex text-xs font-bold px-2.5 py-1 rounded-none"
                  style={{ background: AM.primarySoft, color: AM.primaryText }}
                >
                  今天
                </button>
              </div>
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
                  const isSelected = popupDate === cell.date;
                  const dayBookable = !isPast && summary.dayBookable;
                  const isFull = !isPast && !dayBookable;

                  // 過期日一律顯示（反白不可點）；其餘依篩選
                  const showByFilter =
                    (dayBookable && filterAvailable) || (isFull && filterFull);
                  const visible =
                    isPast ||
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
                      disabled={isPast || isFull}
                      aria-disabled={isPast || isFull}
                      onClick={() => dayBookable && openDayPopup(cell.date)}
                      className="aspect-square rounded-none border text-left p-1 sm:p-2 flex flex-col transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:hover:brightness-100 hover:brightness-[0.98]"
                      style={{
                        background: bg,
                        borderColor: border,
                        color,
                        opacity: isPast || isFull ? 0.4 : 1,
                        filter:
                          isPast || isFull ? "grayscale(0.95)" : undefined,
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
              或電話聯繫。
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
              <a
                href={PHONE_TEL}
                className="w-full sm:w-auto inline-flex items-center justify-center rounded-none px-5 py-3 text-sm font-bold border"
                style={{ borderColor: AM.border, color: AM.primaryText }}
              >
                {PHONE_DISPLAY}
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
                          整點起始
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
                        可約 {availableCount}／{visibleCourtSlots.length}
                      </span>
                    </div>

                    <div
                      className="space-y-0 border-t"
                      style={{ borderColor: AM.border }}
                    >
                      {visibleCourtSlots.map((slot) => {
                        const isPast = slot.state === "past";
                        const isAvailable = slot.state === "available";
                        const isSelected =
                          isAvailable && selectedSlotKey === slot.key;
                        const isBlocked = slot.state === "blocked";
                        const label = isPast
                          ? "已過"
                          : isBlocked
                            ? "關閉"
                            : isAvailable
                              ? "可預約"
                              : "已預約";

                        return (
                          <button
                            key={slot.key}
                            type="button"
                            disabled={!isAvailable}
                            onClick={() =>
                              isAvailable && setSelectedSlotKey(slot.key)
                            }
                            className="w-full rounded-none border-x border-b px-3 py-3 grid grid-cols-[1fr_auto] items-center gap-3 text-left transition-colors disabled:cursor-not-allowed"
                            style={{
                              borderColor: isSelected ? AM.primary : AM.border,
                              background: isSelected
                                ? AM.primarySoft
                                : isPast
                                  ? "#EEF1F4"
                                  : isAvailable
                                    ? "#FFFFFF"
                                    : "#F7F8FA",
                              opacity: isPast ? 0.45 : isAvailable ? 1 : 0.72,
                            }}
                          >
                            <div className="min-w-0">
                              <p
                                className="text-[15px] font-extrabold tabular-nums leading-none tracking-tight"
                                style={{
                                  color:
                                    isPast || !isAvailable
                                      ? "#98A2AE"
                                      : AM.text,
                                  textDecoration: isPast
                                    ? "line-through"
                                    : "none",
                                }}
                              >
                                {slot.start}
                                <span className="text-[#C0C8D2] mx-1">–</span>
                                {slot.end}
                              </p>
                              {!isAvailable && !isPast && slot.booking && (
                                <p className="text-[11px] text-[#8B96A5] mt-1.5 leading-none truncate">
                                  {isBlocked
                                    ? slot.booking.note || "場地關閉"
                                    : maskName(slot.booking.name)}
                                </p>
                              )}
                            </div>
                            <span
                              className="shrink-0 w-[52px] sm:w-[56px] text-center text-[10px] font-extrabold px-0 py-1.5 rounded-none leading-none"
                              style={{
                                background: isSelected
                                  ? AM.primary
                                  : isPast
                                    ? "#E2E6EB"
                                    : isAvailable
                                      ? AM.successSoft
                                      : isBlocked
                                        ? "#E8ECF0"
                                        : AM.primarySoft,
                                color: isSelected
                                  ? "#FFFFFF"
                                  : isPast
                                    ? "#8B96A5"
                                    : isAvailable
                                      ? "#0F8A52"
                                      : isBlocked
                                        ? "#6B7580"
                                        : AM.primaryText,
                              }}
                            >
                              {label}
                            </span>
                          </button>
                        );
                      })}
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
                          href={LINE_URL}
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
                    <a
                      href={PHONE_TEL}
                      className="inline-flex w-full items-center justify-center rounded-none px-4 py-2.5 text-sm font-bold text-[#5B6B7C]"
                    >
                      電話 {PHONE_DISPLAY}
                    </a>
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
