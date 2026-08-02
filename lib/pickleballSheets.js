/**
 * 匹克球場預約 — Google Sheets 讀取與正規化
 *
 * 預期分頁標題：{M}月份收入（例：7月份收入）
 * 欄位：日期 / 預約時間 / 場地 / 費用 / 收款狀況 / 明細 /（可選）開始時間 / 結束時間
 */

import { google } from "googleapis";
import {
  PICKLEBALL_VENUE,
  minutesToHm,
  parseHmToMinutes,
  todayDateStrTaipei,
  toPublicBookings,
} from "@/lib/pickleballMock";

const HEADER_ALIASES = {
  date: ["日期", "date"],
  timeRange: ["預約時間", "時間", "時段"],
  court: ["場地", "court"],
  fee: ["費用", "fee"],
  payment: ["收款狀況", "收款", "付款狀況"],
  name: ["明細", "姓名", "預約者", "name"],
  start: ["開始時間", "start", "start time"],
  end: ["結束時間", "end", "end time"],
};

function getPrivateKey() {
  const raw = process.env.GOOGLE_SHEETS_PRIVATE_KEY || "";
  return raw.replace(/\\n/g, "\n");
}

function assertSheetsConfig() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = getPrivateKey();
  if (!spreadsheetId || !clientEmail || !privateKey) {
    throw new Error(
      "缺少 Google Sheets 設定（GOOGLE_SHEETS_SPREADSHEET_ID / CLIENT_EMAIL / PRIVATE_KEY）",
    );
  }
  return { spreadsheetId, clientEmail, privateKey };
}

function getSheetsClient() {
  const { clientEmail, privateKey } = assertSheetsConfig();
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

export function monthSheetTitle(month) {
  const pattern =
    process.env.PICKLEBALL_SHEET_TITLE_PATTERN || "{M}月份收入";
  return pattern.replace("{M}", String(Number(month)));
}

function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function buildHeaderIndex(headerRow) {
  const index = {};
  const normalized = headerRow.map(normalizeHeader);
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const found = aliases
      .map((a) => normalized.indexOf(normalizeHeader(a)))
      .find((i) => i >= 0);
    if (found != null && found >= 0) index[key] = found;
  }
  // 欄位位置 fallback（對齊目前表結構）
  if (index.date == null) index.date = 0;
  if (index.timeRange == null) index.timeRange = 1;
  if (index.court == null) index.court = 2;
  if (index.fee == null) index.fee = 3;
  if (index.payment == null) index.payment = 4;
  if (index.name == null) index.name = 5;
  if (index.start == null) index.start = 7; // H
  if (index.end == null) index.end = 8; // I
  return index;
}

function cell(row, i) {
  if (i == null || i < 0) return "";
  return String(row[i] ?? "").trim();
}

/** 2026/07/01 | 2026-07-01 | Date serial-ish strings → YYYY-MM-DD */
export function normalizeDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return "";
  const y = m[1];
  const mo = String(parseInt(m[2], 10)).padStart(2, "0");
  const d = String(parseInt(m[3], 10)).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/** 9:00 / 09:00 → HH:mm */
export function normalizeTime(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(min)) return "";
  if (h < 0 || h > 23 || min < 0 || min > 59) return "";
  return minutesToHm(h * 60 + min);
}

/** 11:00~13:00 / 11:00-13:00 / 11:00～13:00 */
export function parseTimeRange(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2}:\d{2})\s*[~\-–—～至到]\s*(\d{1,2}:\d{2})/);
  if (!m) return null;
  const start = normalizeTime(m[1]);
  const end = normalizeTime(m[2]);
  if (!start || !end) return null;
  return { start, end };
}

/** A | B | AB → ["A"] | ["B"] | ["A","B"] */
export function parseCourts(raw) {
  const s = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!s) return [];
  if (s === "AB" || s === "A+B" || s === "A/B" || s === "A＆B" || s === "A&B") {
    return ["A", "B"];
  }
  if (s === "A" || s === "B") return [s];
  // 容錯：含 A 與 B
  const out = [];
  if (s.includes("A")) out.push("A");
  if (s.includes("B")) out.push("B");
  return out;
}

/**
 * @returns {{ court: "A"|"B", date: string, start: string, end: string, name: string, status: "booked", note?: string }[]}
 */
export function normalizeSheetRows(values) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const header = values[0] || [];
  const idx = buildHeaderIndex(header);
  const bookings = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    const date = normalizeDate(cell(row, idx.date));
    if (!date) continue;

    let start = normalizeTime(cell(row, idx.start));
    let end = normalizeTime(cell(row, idx.end));
    if (!start || !end) {
      const range = parseTimeRange(cell(row, idx.timeRange));
      if (range) {
        start = range.start;
        end = range.end;
      }
    }
    if (!start || !end) continue;
    if (parseHmToMinutes(end) <= parseHmToMinutes(start)) continue;

    const courts = parseCourts(cell(row, idx.court));
    if (!courts.length) continue;

    const name = cell(row, idx.name) || "預約";
    const fee = cell(row, idx.fee);
    const payment = cell(row, idx.payment);
    const note = [fee, payment].filter(Boolean).join(" · ");

    for (const court of courts) {
      bookings.push({
        court,
        date,
        start,
        end,
        name,
        status: "booked",
        note,
      });
    }
  }

  return bookings;
}

export async function fetchSheetValuesForMonth({ year, month }) {
  const today = todayDateStrTaipei();
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const monthEnd = (() => {
    const last = new Date(year, month, 0).getDate();
    return `${prefix}-${String(last).padStart(2, "0")}`;
  })();

  // 整月都已過期：不讀 Sheets，也不吐任何預約列
  if (monthEnd < today) {
    return {
      venue: PICKLEBALL_VENUE,
      year,
      month,
      bookings: [],
      source: "sheets",
      sheetTitle: null,
      fetchedAt: new Date().toISOString(),
      minDate: today,
    };
  }

  const { spreadsheetId } = assertSheetsConfig();
  const sheets = getSheetsClient();
  const title = monthSheetTitle(month);

  let meta;
  try {
    meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    });
  } catch (e) {
    const msg = e?.message || String(e);
    if (/permission|403|insufficient/i.test(msg)) {
      throw new Error(
        `無法讀取試算表（權限）。請將表共用給 ${process.env.GOOGLE_SHEETS_CLIENT_EMAIL}（檢視者）`,
      );
    }
    throw new Error(`Google Sheets API 錯誤：${msg}`);
  }

  const titles = (meta.data.sheets || []).map((s) => s.properties?.title);
  if (!titles.includes(title)) {
    throw new Error(
      `找不到分頁「${title}」。現有分頁：${titles.filter(Boolean).join("、") || "（無）"}`,
    );
  }

  const range = `'${title}'!A:I`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
    majorDimension: "ROWS",
  });

  const values = res.data.values || [];
  const all = normalizeSheetRows(values);
  // 僅回傳未結束的預約；過期日／當日已結束時段不吐給前端
  // 進行中時段保留佔用衝突，但清空姓名避免被抓
  const bookings = toPublicBookings(
    all.filter((b) => b.date.startsWith(prefix) && b.date >= today),
  );

  return {
    venue: PICKLEBALL_VENUE,
    year,
    month,
    bookings,
    source: "sheets",
    sheetTitle: title,
    fetchedAt: new Date().toISOString(),
    minDate: today,
  };
}
