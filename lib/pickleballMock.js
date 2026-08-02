/**
 * 匹克球場預約 — 資料契約（對齊 Google Sheets「表_N月」）
 *
 * Sheets：日期 / 預約時間 / 場地(A|B|AB) / 費用 / 收款狀況 / 明細 / 開始時間 / 結束時間
 * court: "A" | "B"（AB 會拆成兩筆）
 * date: "YYYY-MM-DD"
 * start / end: "HH:mm"
 * name: 明細
 * status: "booked" | "cancelled" | "blocked"
 * note: 費用 · 收款狀況
 *
 * 營業時間：06:00–22:00
 */

export const PICKLEBALL_VENUE = {
  name: "匹克領域",
  courts: ["A", "B"],
  timezone: "Asia/Taipei",
  /** 營業開始／結束（分鐘自 0 點起算） */
  openMinutes: 6 * 60, // 06:00
  closeMinutes: 22 * 60, // 22:00
  openLabel: "06:00",
  closeLabel: "22:00",
};

/** @typedef {{ court: "A"|"B", date: string, start: string, end: string, name: string, status: "booked"|"cancelled"|"blocked", note?: string }} PickleballBooking */

function pad(n) {
  return String(n).padStart(2, "0");
}

export function minutesToHm(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${pad(h)}:${pad(m)}`;
}

export function parseHmToMinutes(hm) {
  const [h, m] = String(hm || "0:0")
    .split(":")
    .map((x) => parseInt(x, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export function todayDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Asia/Taipei 的今日 YYYY-MM-DD（伺服器過濾過期資料用） */
export function todayDateStrTaipei(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: PICKLEBALL_VENUE.timezone || "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Asia/Taipei 當下時刻（自 0 時起的分鐘數） */
export function nowMinutesTaipei(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: PICKLEBALL_VENUE.timezone || "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * 預約是否已完全結束（過期日，或當日結束時間 ≤ 現在）
 * → API／前端都不應再吐出這筆資料
 */
export function isBookingFullyPast(booking, now = new Date()) {
  if (!booking?.date) return true;
  const today = todayDateStrTaipei(now);
  if (booking.date < today) return true;
  if (booking.date > today) return false;
  const endMin = parseHmToMinutes(booking.end);
  return endMin <= nowMinutesTaipei(now);
}

/**
 * 此時段起始是否已過（當日 start ≤ 現在）→ UI 反白不可約
 */
export function isSlotStartPast(dateStr, startMin, now = new Date()) {
  if (!dateStr) return true;
  const today = todayDateStrTaipei(now);
  if (dateStr < today) return true;
  if (dateStr > today) return false;
  return Number(startMin) <= nowMinutesTaipei(now);
}

/** 過濾掉已結束的預約列（含當日已結束時段） */
export function filterFutureBookings(bookings = [], now = new Date()) {
  return (bookings || []).filter((b) => !isBookingFullyPast(b, now));
}

/**
 * 對外公開用：已結束不回傳；已開始（進行中）保留衝突判斷但清空姓名／備註
 */
export function toPublicBookings(bookings = [], now = new Date()) {
  return filterFutureBookings(bookings, now).map((b) => {
    if (isSlotStartPast(b.date, parseHmToMinutes(b.start), now)) {
      return {
        ...b,
        name: "",
        note: b.status === "blocked" ? b.note || "場地關閉" : "",
      };
    }
    return b;
  });
}

function dateStr(y, mIndex, day) {
  return `${y}-${pad(mIndex + 1)}-${pad(day)}`;
}

const SAMPLE_NAMES = [
  "王小明",
  "陳美玲",
  "林志豪",
  "黃大偉",
  "張雅婷",
  "吳怡君",
  "社團包場",
  "夜間聯誼",
];

/**
 * 以「今天」為基準，往後 12 個月 mock（僅整點時段）
 * 規則：六日幾乎已滿；平日多段已約，並穿插若干已滿日
 * @returns {PickleballBooking[]}
 */
export function getMockPickleballBookings(now = new Date()) {
  /** @type {PickleballBooking[]} */
  const rows = [];
  const y0 = now.getFullYear();
  const m0 = now.getMonth();
  const open = PICKLEBALL_VENUE.openMinutes;
  const close = PICKLEBALL_VENUE.closeMinutes;

  /** A＋B 全日 09–22 整點佔滿 → 日曆「已滿」 */
  const pushFullDay = (ds, seed, opts = {}) => {
    const blocked = !!opts.blocked;
    for (const court of ["A", "B"]) {
      for (let start = open; start < close; start += 60) {
        const name = blocked
          ? "社團包場"
          : SAMPLE_NAMES[
              (seed + start / 60 + court.charCodeAt(0)) % SAMPLE_NAMES.length
            ];
        rows.push({
          court,
          date: ds,
          start: minutesToHm(start),
          end: minutesToHm(start + 60),
          name,
          status: blocked ? "blocked" : "booked",
          note: blocked ? "全日關閉" : "全日已滿",
        });
      }
    }
  };

  /** 多段已預約，穿插少量空檔（未滿）— 僅整點起始 */
  const pushBusyDay = (ds, court, seed, count, tight = false) => {
    let cursor = open + ((seed + court.charCodeAt(0) * 3) % 3) * 60;
    let added = 0;
    let guard = 0;
    while (added < count && cursor + 60 <= close && guard < 48) {
      guard += 1;
      const dur = (seed + added + court.charCodeAt(0)) % 3 === 0 ? 120 : 60;
      const endMin = Math.min(close, cursor + dur);
      if (endMin - cursor < 60) break;

      const name =
        SAMPLE_NAMES[(seed + added + court.charCodeAt(0)) % SAMPLE_NAMES.length];
      const blocked = name === "社團包場" && (seed + added) % 11 === 0;

      rows.push({
        court,
        date: ds,
        start: minutesToHm(cursor),
        end: minutesToHm(endMin),
        name,
        status: blocked ? "blocked" : "booked",
        note: blocked ? "維護／包場" : dur === 120 ? "2 小時" : "",
      });
      added += 1;

      if (tight) {
        cursor = endMin;
      } else {
        const gap = ((seed + added * 5) % 3) * 60;
        cursor = endMin + gap;
        if ((seed + added) % 7 === 0) cursor += 60;
      }
    }
  };

  for (let offset = 0; offset < 12; offset++) {
    const d0 = new Date(y0, m0 + offset, 1);
    const y = d0.getFullYear();
    const m = d0.getMonth();
    const daysInMonth = new Date(y, m + 1, 0).getDate();

    for (let day = 1; day <= daysInMonth; day++) {
      const dt = new Date(y, m, day);
      const dow = dt.getDay();
      const ds = dateStr(y, m, day);
      const seed = y * 10000 + (m + 1) * 100 + day;
      const isWeekend = dow === 0 || dow === 6;
      const roll = ((seed * 9301 + 49297) % 233280) / 233280;

      // 六日：約 92% 已滿；其餘少數「極忙但仍有空檔」
      if (isWeekend) {
        if (roll < 0.92) {
          pushFullDay(ds, seed, { blocked: day % 17 === 0 });
        } else {
          pushBusyDay(ds, "A", seed, 10, true);
          pushBusyDay(ds, "B", seed + 9, 10, true);
        }
        continue;
      }

      // 平日：約 28% 已滿；約 55% 多段已約；其餘空檔較多
      if (roll < 0.28) {
        pushFullDay(ds, seed, { blocked: false });
        continue;
      }
      if (roll > 0.83) continue; // 約 17% 全日幾乎沒約

      const bothCourts = roll > 0.38;
      const courts = bothCourts ? ["A", "B"] : [roll > 0.55 ? "A" : "B"];
      for (const court of courts) {
        const base = 5;
        const extra = (seed + court.charCodeAt(0)) % 4; // 5～8 段
        pushBusyDay(ds, court, seed, base + extra, roll < 0.45);
      }
    }
  }

  // 今天固定示範：多段已預約（僅整點），保持可點開
  const today = todayDateStr(now);
  const todayDemos = [
    { court: "A", start: "09:00", end: "10:00", name: "陳美玲", note: "雙打" },
    { court: "A", start: "10:00", end: "11:00", name: "林志豪", note: "" },
    { court: "A", start: "11:00", end: "12:00", name: "王小明", note: "" },
    { court: "A", start: "13:00", end: "14:00", name: "黃大偉", note: "" },
    { court: "A", start: "15:00", end: "16:00", name: "張雅婷", note: "" },
    { court: "A", start: "16:00", end: "18:00", name: "吳怡君", note: "2 小時" },
    { court: "A", start: "19:00", end: "20:00", name: "夜間聯誼", note: "" },
    { court: "A", start: "20:00", end: "21:00", name: "王小明", note: "" },
    { court: "B", start: "09:00", end: "10:00", name: "黃大偉", note: "" },
    { court: "B", start: "10:00", end: "11:00", name: "林志豪", note: "" },
    { court: "B", start: "12:00", end: "13:00", name: "陳美玲", note: "" },
    { court: "B", start: "13:00", end: "14:00", name: "吳怡君", note: "" },
    { court: "B", start: "15:00", end: "16:00", name: "王小明", note: "" },
    { court: "B", start: "16:00", end: "17:00", name: "林志豪", note: "" },
    { court: "B", start: "18:00", end: "19:00", name: "黃大偉", note: "" },
    { court: "B", start: "19:00", end: "20:00", name: "夜間聯誼", note: "" },
    { court: "B", start: "21:00", end: "22:00", name: "社團包場", note: "", status: "blocked" },
  ];
  for (const b of todayDemos) {
    rows.push({
      court: b.court,
      date: today,
      start: b.start,
      end: b.end,
      name: b.name,
      status: b.status || "booked",
      note: b.note || "",
    });
  }

  return rows;
}

/**
 * 瀏覽器端：打 /api/pickleball/schedule（Google Sheets）
 * 可傳 useMock: true 強制走本地 mock（開發用）
 * @param {{ year?: number, month?: number, useMock?: boolean }} opts month 為 1–12
 */
export async function fetchPickleballSchedule(opts = {}) {
  const now = new Date();
  const year = opts.year ?? now.getFullYear();
  const month = opts.month ?? now.getMonth() + 1;

  if (opts.useMock) {
    const today = todayDateStrTaipei(now);
    const prefix = `${year}-${pad(month)}`;
    const all = getMockPickleballBookings(now);
    const bookings = toPublicBookings(
      all.filter((b) => b.date.startsWith(prefix) && b.date >= today),
      now,
    );
    return {
      venue: PICKLEBALL_VENUE,
      year,
      month,
      bookings,
      source: "mock",
      fetchedAt: new Date().toISOString(),
      minDate: today,
    };
  }

  const qs = new URLSearchParams({
    year: String(year),
    month: String(month),
  });
  const res = await fetch(`/api/pickleball/schedule?${qs.toString()}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `載入失敗（${res.status}）`);
  }
  return data;
}
