// ============================================================
// ESC/POS THERMAL PRINTER (via WebUSB)
// Works with most USB thermal receipt printers on Android Chrome.
// ============================================================

// ESC/POS command bytes
const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;

// Known-working printer(s), by USB vendor/product ID. requestDevice()
// below only offers matching devices in Chrome's picker instead of
// every USB device on the phone — add more {vendorId, productId}
// entries here for other printer models.
//
// Confirmed against real hardware 2026-09-05: reports as vendorId
// 8137 (0x1FC9) / productId 8214 (0x2016), productName "Printer-80".
// deviceClass/Subclass/Protocol are 0 at the device level (class info
// lives on the interface instead) — expected for a composite/
// vendor-specific ESC/POS device, not a sign something's wrong.
const KNOWN_PRINTERS = [
  { vendorId: 0x1fc9, productId: 0x2016 }, // "Printer-80"
];

// --- Tunables — adjust these against a real test print, not by eye ---

// Characters per line at the printer's default font. 48 is the
// standard convention for 80mm ESC/POS printers at Font A (12x24 dots)
// — this printer is literally named "Printer-80" so it's the likely
// value, but it's a documented convention, not something confirmed
// against this exact unit. If item names/prices don't line up with
// the paper's actual right edge, or the printer wraps lines onto a
// second row, adjust this first.
const CHARS_PER_LINE = 48;

// Blank lines fed before the cut command, to clear this printer's
// physical head-to-cutter gap. Starting guess — if the cut still
// clips the last line of text, increase it; if there's a lot of
// wasted blank paper before the cut, decrease it.
const FEED_LINES_BEFORE_CUT = 5;

// Maps every CJK/fullwidth character currently used anywhere in this
// project (menu.js, app.js, staff.js, print.js, index.html, staff/index.html)
// to its GB18030 byte encoding. Confirmed empirically on the real
// printer (Xprinter XP-Q200) — it was decoding raw UTF-8 bytes through
// its own built-in GB18030-ish table by default, which is why Chinese
// text printed as different-but-valid Chinese characters rather than
// pure garbage. Sending pre-encoded GB18030 bytes instead fixes that.
const GB18030_TABLE = {
  "、": [0xa1, 0xa2],
  "。": [0xa1, 0xa3],
  "「": [0xa1, 0xb8],
  "」": [0xa1, 0xb9],
  "一": [0xd2, 0xbb],
  "三": [0xc8, 0xfd],
  "上": [0xc9, 0xcf],
  "下": [0xcf, 0xc2],
  "不": [0xb2, 0xbb],
  "中": [0xd6, 0xd0],
  "乳": [0xc8, 0xe9],
  "乾": [0xc7, 0xac],
  "二": [0xb6, 0xfe],
  "五": [0xce, 0xe5],
  "付": [0xb8, 0xb6],
  "以": [0xd2, 0xd4],
  "件": [0xbc, 0xfe],
  "份": [0xb7, 0xdd],
  "伺": [0xcb, 0xc5],
  "但": [0xb5, 0xab],
  "作": [0xd7, 0xf7],
  "你": [0xc4, 0xe3],
  "使": [0xca, 0xb9],
  "來": [0x81, 0xed],
  "例": [0xc0, 0xfd],
  "值": [0xd6, 0xb5],
  "備": [0x82, 0xe4],
  "價": [0x83, 0x72],
  "優": [0x83, 0x9e],
  "儲": [0x83, 0xa6],
  "先": [0xcf, 0xc8],
  "克": [0xbf, 0xcb],
  "兌": [0x83, 0xb6],
  "免": [0xc3, 0xe2],
  "入": [0xc8, 0xeb],
  "全": [0xc8, 0xab],
  "六": [0xc1, 0xf9],
  "再": [0xd4, 0xd9],
  "冰": [0xb1, 0xf9],
  "出": [0xb3, 0xf6],
  "列": [0xc1, 0xd0],
  "利": [0xc0, 0xfb],
  "到": [0xb5, 0xbd],
  "前": [0xc7, 0xb0],
  "力": [0xc1, 0xa6],
  "功": [0xb9, 0xa6],
  "加": [0xbc, 0xd3],
  "動": [0x84, 0xd3],
  "包": [0xb0, 0xfc],
  "化": [0xbb, 0xaf],
  "匯": [0x85, 0x52],
  "午": [0xce, 0xe7],
  "半": [0xb0, 0xeb],
  "印": [0xd3, 0xa1],
  "即": [0xbc, 0xb4],
  "厚": [0xba, 0xf1],
  "原": [0xd4, 0xad],
  "友": [0xd3, 0xd1],
  "取": [0xc8, 0xa1],
  "可": [0xbf, 0xc9],
  "司": [0xcb, 0xbe],
  "合": [0xba, 0xcf],
  "名": [0xc3, 0xfb],
  "吐": [0xcd, 0xc2],
  "味": [0xce, 0xb6],
  "命": [0xc3, 0xfc],
  "咔": [0xdf, 0xc7],
  "咖": [0xbf, 0xa7],
  "品": [0xc6, 0xb7],
  "員": [0x86, 0x54],
  "哥": [0xb8, 0xe7],
  "商": [0xc9, 0xcc],
  "啟": [0x86, 0xa2],
  "啡": [0xb7, 0xc8],
  "啦": [0xc0, 0xb2],
  "單": [0x86, 0xce],
  "器": [0xc6, 0xf7],
  "四": [0xcb, 0xc4],
  "回": [0xbb, 0xd8],
  "培": [0xc5, 0xe0],
  "基": [0xbb, 0xf9],
  "堡": [0xb1, 0xa4],
  "場": [0x88, 0xf6],
  "塊": [0x89, 0x4b],
  "墨": [0xc4, 0xab],
  "天": [0xcc, 0xec],
  "失": [0xca, 0xa7],
  "奶": [0xc4, 0xcc],
  "如": [0xc8, 0xe7],
  "始": [0xca, 0xbc],
  "姓": [0xd0, 0xd5],
  "嫩": [0xc4, 0xdb],
  "存": [0xb4, 0xe6],
  "完": [0xcd, 0xea],
  "客": [0xbf, 0xcd],
  "室": [0xca, 0xd2],
  "尋": [0x8c, 0xa4],
  "對": [0x8c, 0xa6],
  "小": [0xd0, 0xa1],
  "尚": [0xc9, 0xd0],
  "工": [0xb9, 0xa4],
  "巧": [0xc7, 0xc9],
  "已": [0xd2, 0xd1],
  "帳": [0x8e, 0xa4],
  "常": [0xb3, 0xa3],
  "店": [0xb5, 0xea],
  "度": [0xb6, 0xc8],
  "廚": [0x8f, 0x4e],
  "式": [0xca, 0xbd],
  "待": [0xb4, 0xfd],
  "後": [0xe1, 0xe1],
  "從": [0x8f, 0xc4],
  "德": [0xb5, 0xc2],
  "心": [0xd0, 0xc4],
  "快": [0xbf, 0xec],
  "愛": [0x90, 0xdb],
  "應": [0x91, 0xaa],
  "成": [0xb3, 0xc9],
  "我": [0xce, 0xd2],
  "或": [0xbb, 0xf2],
  "房": [0xb7, 0xbf],
  "手": [0xca, 0xd6],
  "打": [0xb4, 0xf2],
  "扣": [0xbf, 0xdb],
  "找": [0xd5, 0xd2],
  "抓": [0xd7, 0xa5],
  "折": [0xd5, 0xdb],
  "抵": [0xb5, 0xd6],
  "拉": [0xc0, 0xad],
  "招": [0xd5, 0xd0],
  "拿": [0xc4, 0xc3],
  "按": [0xb0, 0xb4],
  "捲": [0x92, 0xd4],
  "排": [0xc5, 0xc5],
  "接": [0xbd, 0xd3],
  "推": [0xcd, 0xc6],
  "換": [0x93, 0x51],
  "搜": [0xcb, 0xd1],
  "擇": [0x93, 0xf1],
  "據": [0x93, 0xfe],
  "支": [0xd6, 0xa7],
  "收": [0xca, 0xd5],
  "改": [0xb8, 0xc4],
  "敗": [0x94, 0xa1],
  "數": [0x94, 0xb5],
  "文": [0xce, 0xc4],
  "料": [0xc1, 0xcf],
  "新": [0xd0, 0xc2],
  "方": [0xb7, 0xbd],
  "日": [0xc8, 0xd5],
  "早": [0xd4, 0xe7],
  "時": [0x95, 0x72],
  "更": [0xb8, 0xfc],
  "最": [0xd7, 0xee],
  "會": [0x95, 0xfe],
  "月": [0xd4, 0xc2],
  "朋": [0xc5, 0xf3],
  "服": [0xb7, 0xfe],
  "未": [0xce, 0xb4],
  "末": [0xc4, 0xa9],
  "本": [0xb1, 0xbe],
  "杯": [0xb1, 0xad],
  "板": [0xb0, 0xe5],
  "果": [0xb9, 0xfb],
  "查": [0xb2, 0xe9],
  "柳": [0xc1, 0xf8],
  "根": [0xb8, 0xf9],
  "格": [0xb8, 0xf1],
  "條": [0x97, 0x6c],
  "棉": [0xc3, 0xde],
  "榛": [0xe9, 0xbb],
  "樂": [0x98, 0xb7],
  "機": [0x99, 0x43],
  "檬": [0xc3, 0xca],
  "檸": [0x99, 0x8e],
  "次": [0xb4, 0xce],
  "款": [0xbf, 0xee],
  "正": [0xd5, 0xfd],
  "段": [0xb6, 0xce],
  "汁": [0xd6, 0xad],
  "沙": [0xc9, 0xb3],
  "法": [0xb7, 0xa8],
  "泡": [0xc5, 0xdd],
  "泥": [0xc4, 0xe0],
  "泰": [0xcc, 0xa9],
  "洋": [0xd1, 0xf3],
  "消": [0xcf, 0xfb],
  "測": [0x9c, 0x79],
  "滿": [0x9d, 0x4d],
  "漢": [0x9d, 0x68],
  "漿": [0x9d, 0x7b],
  "潛": [0x9d, 0x93],
  "火": [0xbb, 0xf0],
  "炸": [0xd5, 0xa8],
  "為": [0x9e, 0xe9],
  "無": [0x9f, 0x6f],
  "煉": [0x9f, 0x92],
  "煎": [0xbc, 0xe5],
  "熟": [0xca, 0xec],
  "熱": [0x9f, 0xe1],
  "燻": [0xa0, 0x60],
  "片": [0xc6, 0xac],
  "牌": [0xc5, 0xc6],
  "牛": [0xc5, 0xa3],
  "物": [0xce, 0xef],
  "特": [0xcc, 0xd8],
  "狗": [0xb9, 0xb7],
  "玉": [0xd3, 0xf1],
  "現": [0xac, 0x46],
  "球": [0xc7, 0xf2],
  "理": [0xc0, 0xed],
  "甜": [0xcc, 0xf0],
  "生": [0xc9, 0xfa],
  "用": [0xd3, 0xc3],
  "登": [0xb5, 0xc7],
  "發": [0xb0, 0x6c],
  "的": [0xb5, 0xc4],
  "皮": [0xc6, 0xa4],
  "目": [0xc4, 0xbf],
  "省": [0xca, 0xa1],
  "看": [0xbf, 0xb4],
  "確": [0xb4, 0x5f],
  "碼": [0xb4, 0x61],
  "示": [0xca, 0xbe],
  "福": [0xb8, 0xa3],
  "稍": [0xc9, 0xd4],
  "積": [0xb7, 0x65],
  "符": [0xb7, 0xfb],
  "算": [0xcb, 0xe3],
  "米": [0xc3, 0xd7],
  "粒": [0xc1, 0xa3],
  "糕": [0xb8, 0xe2],
  "糖": [0xcc, 0xc7],
  "紀": [0xbc, 0x6f],
  "約": [0xbc, 0x73],
  "紅": [0xbc, 0x74],
  "素": [0xcb, 0xd8],
  "累": [0xc0, 0xdb],
  "結": [0xbd, 0x59],
  "網": [0xbe, 0x57],
  "線": [0xbe, 0x80],
  "編": [0xbe, 0x8e],
  "縫": [0xbf, 0x70],
  "總": [0xbf, 0x82],
  "繫": [0xc0, 0x4d],
  "繼": [0xc0, 0x5e],
  "續": [0xc0, 0x6d],
  "美": [0xc3, 0xc0],
  "義": [0xc1, 0x78],
  "聊": [0xc1, 0xc4],
  "聯": [0xc2, 0x93],
  "肉": [0xc8, 0xe2],
  "脆": [0xb4, 0xe0],
  "腸": [0xc4, 0x63],
  "腿": [0xcd, 0xc8],
  "自": [0xd7, 0xd4],
  "至": [0xd6, 0xc1],
  "與": [0xc5, 0x63],
  "艇": [0xcd, 0xa7],
  "芋": [0xd3, 0xf3],
  "芥": [0xbd, 0xe6],
  "花": [0xbb, 0xa8],
  "茶": [0xb2, 0xe8],
  "草": [0xb2, 0xdd],
  "荷": [0xba, 0xc9],
  "莎": [0xc9, 0xaf],
  "莓": [0xdd, 0xae],
  "菜": [0xb2, 0xcb],
  "蔔": [0xca, 0x4e],
  "蔥": [0xca, 0x5b],
  "蔬": [0xca, 0xdf],
  "薦": [0xcb, 0x5d],
  "薯": [0xca, 0xed],
  "藍": [0xcb, 0x7b],
  "蘋": [0xcc, 0x4f],
  "蘿": [0xcc, 0x7d],
  "處": [0xcc, 0x8e],
  "號": [0xcc, 0x96],
  "蛋": [0xb5, 0xb0],
  "蜂": [0xb7, 0xe4],
  "蜜": [0xc3, 0xdb],
  "表": [0xb1, 0xed],
  "製": [0xd1, 0x75],
  "西": [0xce, 0xf7],
  "要": [0xd2, 0xaa],
  "覽": [0xd3, 0x5b],
  "解": [0xbd, 0xe2],
  "訂": [0xd3, 0x86],
  "計": [0xd3, 0x8b],
  "訪": [0xd4, 0x4c],
  "註": [0xd4, 0x5d],
  "詢": [0xd4, 0x83],
  "試": [0xd4, 0x87],
  "該": [0xd4, 0x93],
  "認": [0xd5, 0x4a],
  "誤": [0xd5, 0x60],
  "調": [0xd5, 0x7b],
  "請": [0xd5, 0x88],
  "豆": [0xb6, 0xb9],
  "象": [0xcf, 0xf3],
  "豬": [0xd8, 0x69],
  "貝": [0xd8, 0x90],
  "買": [0xd9, 0x49],
  "費": [0xd9, 0x4d],
  "購": [0xd9, 0x8f],
  "起": [0xc6, 0xf0],
  "足": [0xd7, 0xe3],
  "路": [0xc2, 0xb7],
  "身": [0xc9, 0xed],
  "車": [0xdc, 0x87],
  "軌": [0xdc, 0x89],
  "軟": [0xdc, 0x9b],
  "載": [0xdd, 0x64],
  "輕": [0xdd, 0x70],
  "輸": [0xdd, 0x94],
  "辣": [0xc0, 0xb1],
  "近": [0xbd, 0xfc],
  "送": [0xcb, 0xcd],
  "速": [0xcb, 0xd9],
  "連": [0xdf, 0x42],
  "週": [0xdf, 0x4c],
  "進": [0xdf, 0x4d],
  "選": [0xdf, 0x78],
  "酥": [0xcb, 0xd6],
  "酪": [0xc0, 0xd2],
  "醬": [0xe1, 0x75],
  "重": [0xd6, 0xd8],
  "金": [0xbd, 0xf0],
  "錄": [0xe4, 0x9b],
  "錯": [0xe5, 0x65],
  "鎖": [0xe6, 0x69],
  "鐵": [0xe8, 0x46],
  "門": [0xe9, 0x54],
  "閉": [0xe9, 0x5d],
  "開": [0xe9, 0x5f],
  "間": [0xe9, 0x67],
  "關": [0xea, 0x50],
  "集": [0xbc, 0xaf],
  "雞": [0xeb, 0x75],
  "非": [0xb7, 0xc7],
  "頌": [0xed, 0x9e],
  "預": [0xee, 0x41],
  "顆": [0xee, 0x77],
  "額": [0xee, 0x7e],
  "類": [0xee, 0x90],
  "顧": [0xee, 0x99],
  "顯": [0xef, 0x40],
  "食": [0xca, 0xb3],
  "飲": [0xef, 0x8b],
  "餃": [0xef, 0x9c],
  "餅": [0xef, 0x9e],
  "餐": [0xb2, 0xcd],
  "餘": [0xf0, 0x4e],
  "香": [0xcf, 0xe3],
  "鬆": [0xf3, 0xa0],
  "魚": [0xf4, 0x7e],
  "鮪": [0xf5, 0x6e],
  "鮮": [0xf5, 0x72],
  "麵": [0xfc, 0x49],
  "黃": [0xfc, 0x53],
  "點": [0xfc, 0x63],
  "！": [0xa3, 0xa1],
  "（": [0xa3, 0xa8],
  "）": [0xa3, 0xa9],
  "＋": [0xa3, 0xab],
  "，": [0xa3, 0xac],
  "．": [0xa3, 0xae],
  "：": [0xa3, 0xba],
  // These three were missed by the original character scan (it only
  // covered CJK Unified Ideographs, CJK punctuation, and fullwidth
  // forms) — found by re-scanning every file for ALL non-ASCII
  // characters and diffing against this table. ●/○ are the stamp-card
  // day circles (confirmed garbled on a real order printout); … is
  // padColumns()'s truncation ellipsis, used whenever an item name is
  // too long to fit next to its price.
  "●": [0xa1, 0xf1],
  "○": [0xa1, 0xf0],
  "…": [0xa1, 0xad]
};

function textToBytes(str) {
  const bytes = [];
  for (const ch of str) {
    const mapped = GB18030_TABLE[ch];
    if (mapped) {
      bytes.push(...mapped);
    } else {
      // ASCII passes through unchanged (UTF-8 == ASCII in this range).
      // Anything else not in the table above — a rare CJK character
      // outside today's known menu/UI text, e.g. an unusual character
      // typed into a customer note or member name — falls back to raw
      // UTF-8, same as before. That specific text may still print
      // wrong, but only for characters outside the app's vocabulary.
      bytes.push(...new TextEncoder().encode(ch));
    }
  }
  return new Uint8Array(bytes);
}

// Most CJK characters (and fullwidth punctuation) render at roughly
// double the width of ASCII on thermal printers — e.g. 24x24 dots vs
// 12x24 for Font A. Plain .length undercounts every Chinese character
// in a string, which is almost certainly why the price column was
// drifting out of alignment on real item names (all Chinese). This
// approximates the East Asian Width property without pulling in a
// dependency (this project deliberately has none — see CLAUDE.md).
function displayWidth(str) {
  let width = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    const isWide =
      (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
      (code >= 0x2e80 && code <= 0xa4cf) || // CJK Radicals .. Yi Syllables
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
      (code >= 0xff00 && code <= 0xff60) || // Fullwidth Forms
      (code >= 0xffe0 && code <= 0xffe6);
    width += isWide ? 2 : 1;
  }
  return width;
}

// Lays `left`/`right` out on one line of exactly `width` display
// columns — left-aligned label, right-aligned amount, like a receipt
// line item. Truncates the label (with an ellipsis) instead of
// overflowing, since an unexpectedly long name pushing the price onto
// a second physical line would look worse than a shortened name.
function padColumns(left, right, width) {
  let label = left;
  while (displayWidth(label) + 1 + displayWidth(right) > width && label.length > 0) {
    label = label.slice(0, -1);
  }
  if (label !== left) label = label.slice(0, -1) + "…";
  const gap = Math.max(1, width - displayWidth(label) - displayWidth(right));
  return label + " ".repeat(gap) + right;
}

// Shared low-level renderer: turns a flat list of {text, align, bold,
// size} lines into one ESC/POS byte stream (init → styled lines →
// reset → feed → cut). Both documents below (kitchen ticket, customer
// label) build their own line list but go through this exact same
// loop, so their align/bold/size state-tracking and init/cut framing
// can't drift apart from each other even though their *content* does.
function renderLinesToBytes(lines) {
  const bytes = [];
  const push = (...arr) => bytes.push(...arr);
  const pushText = (str) => push(...textToBytes(str));

  push(ESC, 0x40); // initialize printer — also resets align/bold/size to defaults

  // Track current align/bold/size state and only emit a command when a
  // line's style actually differs from it — e.g. a centered/bold
  // header can't bleed into the body, because the first body line's
  // {align:"left", bold:false, size:"normal"} always emits an
  // explicit reset rather than assuming a prior reset already happened.
  let currentAlign = "left";
  let currentBold = false;
  let currentSize = "normal";

  lines.forEach((line) => {
    if (line.align !== currentAlign) {
      push(ESC, 0x61, line.align === "center" ? 0x01 : 0x00);
      currentAlign = line.align;
    }
    if (line.bold !== currentBold) {
      push(ESC, 0x45, line.bold ? 0x01 : 0x00);
      currentBold = line.bold;
    }
    if (line.size !== currentSize) {
      // GS ! n — character size select. n=0x00 is normal; 0x11 is
      // double width + double height, the standard ESC/POS combo for
      // an emphasized/"large" line.
      push(GS, 0x21, line.size === "large" ? 0x11 : 0x00);
      currentSize = line.size;
    }
    pushText(line.text + "\n");
  });

  // Explicit reset before the trailing feed/cut too, so whatever
  // prints next (the next document, or another job) starts from
  // defaults rather than inheriting the last line's style.
  push(ESC, 0x61, 0x00);
  push(ESC, 0x45, 0x00);
  push(GS, 0x21, 0x00);

  push(ESC, 0x64, FEED_LINES_BEFORE_CUT); // feed blank lines to clear the cutter before cutting
  push(GS, 0x56, 0x00); // full cut

  return new Uint8Array(bytes);
}

// "9/8 (二) 06:00" — same "shift by the fixed +8h offset, read UTC
// fields as Taipei-local fields" trick as app.js's own
// formatPickupSlotLabel() (duplicated here — print.js has no shared
// module with that page's script), and the same output format the
// checkout confirmation screen already shows, so a customer sees one
// consistent time everywhere it's printed/displayed.
function formatPickupTime(isoString) {
  const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
  const weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
  const shifted = new Date(new Date(isoString).getTime() + TAIPEI_OFFSET_MS);
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const weekday = weekdayLabels[shifted.getUTCDay()];
  const hour = String(shifted.getUTCHours()).padStart(2, "0");
  const minute = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${month}/${day} (${weekday}) ${hour}:${minute}`;
}

// ============================================================
// KITCHEN TICKET — printed for whoever is making the food. Just the
// order number (large, so it's readable from across the counter) and
// what to make: no prices, no total, no footer. Deliberately terse.
// ============================================================
function buildKitchenTicketModel(order) {
  const divider = "-".repeat(CHARS_PER_LINE);
  const lines = [];

  lines.push({ text: `訂單編號：${order.shortId}`, align: "center", bold: true, size: "large" });
  // order.pickupSlot comes from orders.pickup_slot (see receiptDataFor()
  // in staff.js) — orders aren't strictly first-come-first-served
  // anymore now that pickup times are reserved, so staff need the
  // committed time here too, not just on the customer's own copy.
  // Always present on any order placed after pickup slots shipped;
  // guarded anyway in case of an older/malformed row.
  if (order.pickupSlot) {
    lines.push({ text: `取餐時間：${formatPickupTime(order.pickupSlot)}`, align: "center", bold: true, size: "large" });
  }
  lines.push({ text: divider, align: "left", bold: false, size: "normal" });

  order.items.forEach((item) => {
    // Qty kept (it's prep-relevant, not price info) — just no $ amount.
    // Split into two lines instead of one "name(modifiers) xN" line —
    // at "large" size the column budget is halved to 24, and packing
    // name+modifiers+qty onto one line overflowed that for most real
    // menu items (see the audit in the buildKitchenTicketModel commit
    // history). Splitting shrinks each line's own text, which fixes
    // the common case; it doesn't guarantee either line individually
    // fits 24 columns — see displayWidth()/CHARS_PER_LINE.
    lines.push({ text: `${item.name} x${item.qty}`, align: "left", bold: true, size: "large" });
    if (item.modifiers) {
      // Indented one level in (2 spaces, not a tab — ESC/POS tab stops
      // aren't guaranteed configured on this printer) so it visually
      // groups under its parent item line rather than reading as a
      // separate entry. Same bold+large as the item line above it.
      lines.push({ text: `  ${item.modifiers}`, align: "left", bold: true, size: "large" });
    }
  });

  return lines;
}

function buildKitchenTicket(order) {
  return renderLinesToBytes(buildKitchenTicketModel(order));
}

// ============================================================
// CUSTOMER LABEL — the itemized receipt for the customer: full price
// breakdown, total, payment status, and the original order#/time
// footer. Chinese-only throughout, matching the menu data itself —
// see CLAUDE.md's site-wide Chinese-only text policy.
// ============================================================
function buildCustomerLabelModel(order) {
  const divider = "-".repeat(CHARS_PER_LINE);
  const lines = [];

  // Member name prints first — large + centered — ahead of even the
  // shop name, so it's the first thing visible when the customer looks
  // at the receipt for pickup. (Placement judgment call: "first" could
  // instead have meant first within the member-info block below the
  // shop header — flag if this isn't what you meant and it's a
  // one-line move.) Guest orders have no order.memberName, so the shop
  // name is simply the first line printed, same as before.
  if (order.memberName) {
    lines.push({ text: order.memberName, align: "center", bold: true, size: "large" });
  }

  lines.push({ text: order.shopName, align: "center", bold: true, size: "normal" });
  lines.push({ text: `訂單編號：${order.shortId}`, align: "left", bold: false, size: "normal" });

  if (order.pickupSlot) {
    lines.push({ text: `取餐時間：${formatPickupTime(order.pickupSlot)}`, align: "left", bold: false, size: "normal" });
  }

  // stampSnapshot/balanceSnapshot are this member's progress/balance as
  // of THIS order, not re-derived from their current real state, so an
  // old receipt stays an accurate record even after later orders change
  // both. ●/○ rather than an emoji/cup glyph for the Fri slot — not
  // every printer codepage has one, and the bracket around it is enough
  // to set it apart from the plain Mon-Thu run without needing a
  // different glyph at all.
  if (order.memberName) {
    const days = (order.stampSnapshot && order.stampSnapshot.days) || [false, false, false, false];
    const unlocked = Boolean(order.stampSnapshot && order.stampSnapshot.unlocked);
    const dayCircles = days.map((filled) => (filled ? "●" : "○")).join("");
    const friCircle = unlocked ? "●" : "○";
    lines.push({ text: `${dayCircles} (${friCircle})`, align: "left", bold: false, size: "normal" });

    if (order.balanceSnapshot != null) {
      lines.push({ text: `儲值餘額 NT$${order.balanceSnapshot}`, align: "left", bold: false, size: "normal" });
    }
  }

  lines.push({ text: divider, align: "left", bold: false, size: "normal" });

  order.items.forEach((item) => {
    const label = item.modifiers ? `${item.name}(${item.modifiers})` : item.name;
    lines.push({
      text: padColumns(`${label} x${item.qty}`, `$${item.subtotal}`, CHARS_PER_LINE),
      align: "left",
      bold: false,
      size: "normal",
    });
  });

  // order.stampDiscount comes from orders.stamp_discount (see
  // receiptDataFor() in staff.js) — only present/non-zero on a Weekday
  // Stamp Card redemption, so this line is conditional (unlike the
  // payment-status line below, which is unconditional but has
  // conditional wording) — same "built once, only rendered when
  // relevant" shape either way. Item lines above still show each
  // item's full, undiscounted price; without this line the printed
  // total wouldn't visibly reconcile against them.
  if (order.stampDiscount) {
    lines.push({
      text: padColumns("集點折抵", `-NT$${order.stampDiscount}`, CHARS_PER_LINE),
      align: "left",
      bold: false,
      size: "normal",
    });
  }

  lines.push({ text: divider, align: "left", bold: false, size: "normal" });
  lines.push({
    text: padColumns("總計", `NT$${order.total}`, CHARS_PER_LINE),
    align: "left",
    bold: true,
    size: "normal",
  });

  // order.paymentMethod comes from orders.payment_method (see
  // receiptDataFor() in staff.js) — 'cash_on_pickup' or 'stored_value'.
  // Always printed, never omitted, regardless of which one it is; only
  // the wording is conditional. Bold + large so it reads as a
  // confirmation, not a detail. Chinese-only, like every other line on
  // this receipt — at "large" size the usable column budget is halved
  // to 24, worth remembering if either wording ever needs to grow.
  lines.push({
    text: order.paymentMethod === "stored_value" ? "已用儲值支付" : "現場付款",
    align: "left",
    bold: true,
    size: "large",
  });

  if (order.note) {
    lines.push({ text: `備註：${order.note}`, align: "left", bold: false, size: "normal" });
  }

  return lines;
}

function buildCustomerLabel(order) {
  return renderLinesToBytes(buildCustomerLabelModel(order));
}

let printerDevice = null;

// Opens + claims a USBDevice the caller has already obtained (via
// either requestDevice()'s picker or getDevices()'s silent list), and
// runs the same live init-command test either way. Shared so
// connectPrinter() and silentReconnect() below can't drift apart.
async function openAndClaim(device) {
  printerDevice = device;
  await printerDevice.open();
  if (printerDevice.configuration === null) {
    await printerDevice.selectConfiguration(1);
  }

  // Log what's actually on the device before assuming anything —
  // interface/endpoint numbers vary by printer model and aren't
  // visible from the top-level device object.
  console.log("[ThermalPrinter] interfaces:", printerDevice.configuration.interfaces);
  printerDevice.configuration.interfaces.forEach((iface) => {
    console.log(`[ThermalPrinter] interface ${iface.interfaceNumber} endpoints:`, iface.alternate.endpoints);
  });

  const iface = printerDevice.configuration.interfaces[0];
  await printerDevice.claimInterface(iface.interfaceNumber); // real number from the device, not assumed

  const outEndpoint = iface.alternate.endpoints.find((e) => e.direction === "out");
  if (!outEndpoint) {
    throw new Error("No OUT endpoint found on this printer's interface.");
  }
  console.log(
    `[ThermalPrinter] claimed interface ${iface.interfaceNumber}, OUT endpoint ${outEndpoint.endpointNumber} — sending test init command`
  );

  // Minimal live test: ESC @ (initialize printer) — resets printer
  // state, doesn't print text or (on most models) feed paper. If this
  // resolves without throwing, data actually reached the printer over
  // this exact interface/endpoint pair, not just that the device
  // picker matched it.
  try {
    await printerDevice.transferOut(outEndpoint.endpointNumber, new Uint8Array([ESC, 0x40]));
    console.log("[ThermalPrinter] test transferOut succeeded — printer accepted the init command");
  } catch (err) {
    console.error("[ThermalPrinter] test transferOut failed:", err);
    throw err;
  }

  return printerDevice;
}

async function connectPrinter() {
  // Chrome will show a device picker limited to KNOWN_PRINTERS above.
  // The user selects their thermal printer once; the browser
  // remembers permission for that device on this site. requestDevice()
  // requires an active user gesture (a click) — this can only be
  // called from the manual "Connect printer" button, never from a
  // background poll loop. See silentReconnect() for that case.
  const device = await navigator.usb.requestDevice({ filters: KNOWN_PRINTERS });
  return openAndClaim(device);
}

// Silently reconnects to a printer Chrome already has permission for
// from a past connectPrinter() call — no picker, no user-gesture
// requirement, so it's safe to call from the auto-print poll loop.
// Returns null (doesn't throw) if there's no previously-authorized
// device currently plugged in, so callers can fall back accordingly.
async function silentReconnect() {
  if (printerDevice) return printerDevice; // already connected this session
  const devices = await navigator.usb.getDevices();
  const device = devices[0]; // KNOWN_PRINTERS only ever authorizes one match
  if (!device) return null;
  return openAndClaim(device);
}

async function printOrder(order) {
  if (!navigator.usb) {
    throw new Error("WebUSB not supported — use Chrome on Android.");
  }
  if (!printerDevice) {
    const reconnected = await silentReconnect();
    if (!reconnected) {
      // No prior authorization to silently reuse — fall back to the
      // picker. Fine for a manual click (has a user gesture); throws
      // if this call isn't inside one (e.g. auto-print with no
      // printer ever connected yet this browser/origin).
      await connectPrinter();
    }
  }

  // Re-derive the OUT endpoint rather than caching it from
  // connectPrinter() — cheap, and avoids relying on state surviving
  // between the two calls. See connectPrinter()'s console.log for
  // this printer's actual interface/endpoint numbers.
  const iface = printerDevice.configuration.interfaces[0];
  const endpoint = iface.alternate.endpoints.find((e) => e.direction === "out");

  // Two separate documents, same short_id, sent as two sequential
  // jobs (each ends in its own cut) over the one connected printer.
  // Kitchen ticket first so food prep can start before the customer
  // label finishes printing. If either transferOut throws, the other
  // has already run or never runs — the caller (staff.js's
  // handlePrint) treats that as one failed print() call and won't
  // mark the order printed, same as today.
  await printerDevice.transferOut(endpoint.endpointNumber, buildKitchenTicket(order));
  await printerDevice.transferOut(endpoint.endpointNumber, buildCustomerLabel(order));
}

// Exposed globally for staff.js to call. CHARS_PER_LINE and the two
// buildXPreview functions let staff/index.html render an on-screen preview
// of both documents from the exact same layout logic as the real
// print, without needing a physical printer to check spacing/
// alignment changes.
window.ThermalPrinter = {
  connectPrinter,
  printOrder,
  buildKitchenTicketPreview: buildKitchenTicketModel,
  buildCustomerLabelPreview: buildCustomerLabelModel,
  CHARS_PER_LINE,
};