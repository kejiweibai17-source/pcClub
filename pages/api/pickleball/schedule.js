import { fetchSheetValuesForMonth } from "@/lib/pickleballSheets";
import {
  PICKLEBALL_VENUE,
  todayDateStrTaipei,
  toPublicBookings,
} from "@/lib/pickleballMock";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const now = new Date();
  const year = parseInt(String(req.query.year || now.getFullYear()), 10);
  const month = parseInt(String(req.query.month || now.getMonth() + 1), 10);

  if (!Number.isFinite(year) || year < 2020 || year > 2100) {
    return res.status(400).json({ error: "invalid year" });
  }
  if (!Number.isFinite(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "invalid month" });
  }

  // 整月都早於今日：直接空結果，避免無謂打 Sheets
  const today = todayDateStrTaipei();
  const monthEndDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(monthEndDay).padStart(2, "0")}`;
  if (monthEnd < today) {
    return res.status(200).json({
      venue: PICKLEBALL_VENUE,
      year,
      month,
      bookings: [],
      source: "sheets",
      sheetTitle: null,
      fetchedAt: new Date().toISOString(),
      minDate: today,
    });
  }

  try {
    const payload = await fetchSheetValuesForMonth({ year, month });
    // 雙重保險：API 出口再濾一次過期／清空進行中姓名
    const safe = {
      ...payload,
      bookings: toPublicBookings(payload?.bookings || [], now),
      minDate: today,
    };
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json(safe);
  } catch (e) {
    console.error("[pickleball/schedule]", e);
    return res.status(502).json({
      error: e?.message || "Failed to load pickleball schedule",
    });
  }
}
