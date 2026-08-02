# pcClub — 匹克領域預約狀態

獨立 Next.js 專案，顯示匹克球場 A／B 場預約狀態（資料來源：Google Sheets）。

## 功能

- 月曆檢視（今日起可選）
- 整點 1 小時時段（06:00–22:00）
- 當日已過時段反白不可選；API 不回傳已結束預約明細
- LINE／電話預約 CTA

## 快速開始

```bash
cp .env.example .env.local
# 填入 Google Sheets 憑證
npm install
npm run dev
```

開啟 [http://localhost:3000](http://localhost:3000)。

## 環境變數

| 變數 | 說明 |
|------|------|
| `GOOGLE_SHEETS_SPREADSHEET_ID` | 試算表 ID |
| `GOOGLE_SHEETS_CLIENT_EMAIL` | Service Account email |
| `GOOGLE_SHEETS_PRIVATE_KEY` | 私鑰（`\n` 換行） |
| `PICKLEBALL_SHEET_TITLE_PATTERN` | 分頁名，預設 `{M}月份收入` |
| `NEXT_PUBLIC_LINE_OA_URL` | LINE 連結（選填） |

請將試算表「共用」給 service account（檢視者）。

## 部署（Vercel）

1. Import 此 repo
2. 在 Project Settings → Environment Variables 填入上表變數
3. Deploy

## 技術

- Next.js 14（Pages Router）
- Tailwind CSS
- Framer Motion
- Google Sheets API（googleapis）
