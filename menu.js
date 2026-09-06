// ============================================================
// MENU DATA
// Edit this file to change what's for sale. No coding needed
// beyond copying this pattern — just add or remove items.
//
// SOURCE: transcribed from a phone photo of the physical board —
// see DOCS/menu-extracted.md for the full transcription notes,
// section-by-section add-on rules, and what's still uncertain.
// Re-check anything marked TODO below once the real PDF arrives.
//
// CUSTOMIZATION: items can carry extra fields beyond the base
// {id, name, nameEn, price}:
//
//   modifierGroups: ["groupId", ...]
//     References entries in the shared `modifierGroups` object below.
//     Each group is either type "single" (radio — exactly one choice,
//     first option is the default) or "multi" (checkboxes — each
//     option toggles independently, price stacks).
//
//   addons: [{ label, price }, ...]
//     One-off checkboxes unique to this item (not shared/reusable —
//     for dish-specific extras, e.g. a single noodle dish's toppings,
//     or a whole category's shared extra like 甜甜Der's marshmallow).
//
//   priceThin / priceThick
//     Use INSTEAD of `price` for items with a bread-thickness choice
//     whose price delta isn't flat across items. `priceThick: null`
//     means that item doesn't offer a thick option at all — no
//     thickness picker is shown for it.
//
// See app.js (lineUnitPrice / describeSelection) for how these are
// priced and rendered.
// ============================================================

// Reusable modifier groups, referenced by id from menu items via
// `modifierGroups: ["someGroupId"]`.
const modifierGroups = {
  cheeseLettuce: {
    label: "加點",
    type: "multi",
    options: [
      { label: "加起司", price: 10 },
      { label: "加生菜", price: 10 },
    ],
  },
  cheeseEgg: {
    label: "加點",
    type: "multi",
    options: [
      { label: "加起司", price: 10 },
      { label: "加蛋", price: 10 },
    ],
  },
  eggPancakeBase: {
    label: "餅皮選擇",
    type: "single",
    options: [
      { label: "原味", price: 0 },
      { label: "酥皮", price: 5 },
      { label: "抓餅", price: 10 },
    ],
  },
  hotCold: {
    label: "冰熱選擇",
    type: "single",
    options: [
      { label: "熱", price: 0 },
      { label: "冰", price: 0 },
    ],
  },
  noodleSpice: {
    label: "辣度選擇",
    type: "single",
    options: [
      { label: "甜辣", price: 0 },
      { label: "特辣", price: 0 },
      { label: "小朋友", price: 0 },
    ],
  },
  eggDoneness: {
    label: "熟度選擇",
    type: "single",
    options: [
      { label: "半熟", price: 0 },
      { label: "全熟", price: 0 },
    ],
  },
  // Not one of the originally-built sample groups — added because
  // 潛艇堡 (submarine sandwich) needs a sauce choice and none of the
  // existing groups fit. Same "single, $0 delta" shape as hotCold /
  // noodleSpice / eggDoneness, just a new options list.
  submarineSauce: {
    label: "醬料選擇",
    type: "single",
    options: [
      { label: "莎莎醬", price: 0 },
      { label: "蜂蜜芥末", price: 0 },
    ],
  },
};

// Shared item-level add-ons, spread across every item in a category
// (see menu-extracted.md — these are printed once at the top of each
// board column, not as separate line items). Declared once here and
// spread onto each item below so the $10/$10 cheese-only rule for
// 蛋餅類 and the $10 marshmallow rule for 甜甜Der aren't repeated by
// hand 18 and 9 times respectively.
const EGG_PANCAKE_CHEESE_ADDON = [{ label: "起司", price: 10 }];
const SWEET_TOAST_MARSHMALLOW_ADDON = [{ label: "棉花糖", price: 10 }];

// TODO: multi-column price areas were the hardest to read from the
// phone photo — menu-extracted.md flags 法式類 and 甜甜Der specifically
// as the most likely spots for a misread digit. Every priceThin/
// priceThick pair in those two categories below carries this same
// TODO; re-check all of them against the PDF once it arrives.
const PRICE_UNVERIFIED = "TODO: verify against PDF — multi-column price, hardest to read from the phone photo";

const MENU = [
  {
    category: "吐司類",
    items: [
      { id: "ts-01", name: "肉排總匯", nameEn: "", price: 80, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-02", name: "招牌肉排蛋", nameEn: "", price: 55, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-03", name: "生菜肉排蛋", nameEn: "", price: 65, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-04", name: "起司肉排蛋", nameEn: "", price: 65, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-05", name: "花生醬肉排蛋", nameEn: "", price: 65, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-06", name: "洋蔥肉排蛋", nameEn: "", price: 65, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-07", name: "義式漢堡肉蛋", nameEn: "", price: 65, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-08", name: "泰式雞肉", nameEn: "", price: 55, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-09", name: "生菜咔啦雞", nameEn: "", price: 55, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-10", name: "生菜雞柳", nameEn: "", price: 50, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-11", name: "鮪魚蛋", nameEn: "", price: 45, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-12", name: "燻雞蛋", nameEn: "", price: 40, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-13", name: "培根蛋", nameEn: "", price: 40, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-14", name: "肉鬆蛋", nameEn: "", price: 40, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-15", name: "火腿蛋", nameEn: "", price: 40, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-16", name: "起司蛋 (素)", nameEn: "", price: 35, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-17", name: "玉米洋蔥蛋 (素)", nameEn: "", price: 35, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-18", name: "蔬菜蛋 (素)", nameEn: "", price: 35, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-19", name: "薯餅蛋", nameEn: "", price: 45, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-20", name: "玉米蛋 (素)", nameEn: "", price: 35, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-21", name: "洋芋肉排", nameEn: "", price: 70, modifierGroups: ["cheeseLettuce"] },
      { id: "ts-22", name: "洋芋鮪魚", nameEn: "", price: 60, modifierGroups: ["cheeseLettuce"] },
    ],
  },
  {
    category: "蛋餅類",
    items: [
      // Every item here gets both the base-swap radio (原味/酥皮/抓餅) and
      // the +起司 checkbox — menu-extracted.md notes these come from the
      // same printed column header, not per-item.
      { id: "eg-01", name: "招牌肉排", nameEn: "", price: 55, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-02", name: "起司肉排", nameEn: "", price: 65, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-03", name: "生菜肉排", nameEn: "", price: 65, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-04", name: "花生醬肉排", nameEn: "", price: 65, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-05", name: "洋蔥肉排", nameEn: "", price: 65, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-06", name: "義式漢堡肉", nameEn: "", price: 55, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-07", name: "泰式雞柳", nameEn: "", price: 50, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-08", name: "黃金泡菜鮪魚 (熱門)", nameEn: "", price: 50, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-09", name: "燻雞", nameEn: "", price: 45, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-10", name: "培根", nameEn: "", price: 40, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-11", name: "肉鬆火腿", nameEn: "", price: 40, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-12", name: "起司 (素)", nameEn: "", price: 40, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-13", name: "玉米洋芋菜 (素)", nameEn: "", price: 35, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-14", name: "薯餅玉米", nameEn: "", price: 45, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-15", name: "洋芋肉排", nameEn: "", price: 70, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-16", name: "洋芋鮪魚", nameEn: "", price: 60, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-17", name: "花生醬培根", nameEn: "", price: 55, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
      { id: "eg-18", name: "原味 (素)", nameEn: "", price: 25, modifierGroups: ["eggPancakeBase"], addons: EGG_PANCAKE_CHEESE_ADDON },
    ],
  },
  {
    category: "墨西哥捲餅",
    items: [
      { id: "wr-01", name: "莎莎醬肉排", nameEn: "", price: 70, modifierGroups: ["cheeseEgg"] },
      { id: "wr-02", name: "莎莎醬義式漢堡肉", nameEn: "", price: 70, modifierGroups: ["cheeseEgg"] },
      { id: "wr-03", name: "洋蔥肉排", nameEn: "", price: 65, modifierGroups: ["cheeseEgg"] },
      { id: "wr-04", name: "泰式雞肉", nameEn: "", price: 65, modifierGroups: ["cheeseEgg"] },
      { id: "wr-05", name: "生菜雞柳", nameEn: "", price: 60, modifierGroups: ["cheeseEgg"] },
      { id: "wr-06", name: "德式香腸", nameEn: "", price: 60, modifierGroups: ["cheeseEgg"] },
    ],
  },
  {
    category: "可頌類",
    items: [
      { id: "cr-01", name: "生菜肉排", nameEn: "", price: 75, modifierGroups: ["cheeseEgg"] },
      { id: "cr-02", name: "洋蔥肉排", nameEn: "", price: 75, modifierGroups: ["cheeseEgg"] },
      { id: "cr-03", name: "義式漢堡肉", nameEn: "", price: 75, modifierGroups: ["cheeseEgg"] },
      { id: "cr-04", name: "生菜雞柳", nameEn: "", price: 70, modifierGroups: ["cheeseEgg"] },
      { id: "cr-05", name: "生菜鮪魚", nameEn: "", price: 70, modifierGroups: ["cheeseEgg"] },
      { id: "cr-06", name: "生菜燻雞", nameEn: "", price: 70, modifierGroups: ["cheeseEgg"] },
      { id: "cr-07", name: "花生醬培根", nameEn: "", price: 70, modifierGroups: ["cheeseEgg"] },
      { id: "cr-08", name: "榛果可可醬", nameEn: "", price: 50, modifierGroups: ["cheeseEgg"] },
      { id: "cr-09", name: "顆粒花生", nameEn: "", price: 50, modifierGroups: ["cheeseEgg"] },
      { id: "cr-10", name: "巧克力 (熱門)", nameEn: "", price: 50, modifierGroups: ["cheeseEgg"] },
      { id: "cr-11", name: "草莓", nameEn: "", price: 50, modifierGroups: ["cheeseEgg"] },
      { id: "cr-12", name: "藍莓", nameEn: "", price: 50, modifierGroups: ["cheeseEgg"] },
      { id: "cr-13", name: "奶酥", nameEn: "", price: 50, modifierGroups: ["cheeseEgg"] },
      { id: "cr-14", name: "藍莓乾酪", nameEn: "", price: 60, modifierGroups: ["cheeseEgg"] },
    ],
  },
  {
    category: "漢堡類",
    items: [
      { id: "bg-01", name: "招牌肉排蛋", nameEn: "", price: 70, modifierGroups: ["cheeseLettuce"] },
      { id: "bg-02", name: "生菜肉排蛋", nameEn: "", price: 70, modifierGroups: ["cheeseLettuce"] },
      { id: "bg-03", name: "起司肉排蛋", nameEn: "", price: 70, modifierGroups: ["cheeseLettuce"] },
      { id: "bg-04", name: "花生醬肉排蛋", nameEn: "", price: 70, modifierGroups: ["cheeseLettuce"] },
      { id: "bg-05", name: "洋蔥肉排蛋", nameEn: "", price: 70, modifierGroups: ["cheeseLettuce"] },
      { id: "bg-06", name: "義式漢堡肉蛋", nameEn: "", price: 70, modifierGroups: ["cheeseLettuce"] },
      { id: "bg-07", name: "鮪魚蛋", nameEn: "", price: 50, modifierGroups: ["cheeseLettuce"] },
      { id: "bg-08", name: "培根蛋", nameEn: "", price: 45, modifierGroups: ["cheeseLettuce"] },
      { id: "bg-09", name: "肉鬆蛋", nameEn: "", price: 45, modifierGroups: ["cheeseLettuce"] },
    ],
  },
  {
    category: "滿福堡",
    items: [
      { id: "mf-01", name: "招牌肉排蛋", nameEn: "", price: 60, modifierGroups: ["cheeseLettuce"] },
      { id: "mf-02", name: "生菜肉排蛋", nameEn: "", price: 70, modifierGroups: ["cheeseLettuce"] },
      { id: "mf-03", name: "起司肉排蛋", nameEn: "", price: 70, modifierGroups: ["cheeseLettuce"] },
      { id: "mf-04", name: "花生醬肉排蛋", nameEn: "", price: 70, modifierGroups: ["cheeseLettuce"] },
      { id: "mf-05", name: "洋蔥肉排蛋", nameEn: "", price: 70, modifierGroups: ["cheeseLettuce"] },
      { id: "mf-06", name: "義式漢堡肉蛋", nameEn: "", price: 70, modifierGroups: ["cheeseLettuce"] },
      { id: "mf-07", name: "生菜雞柳", nameEn: "", price: 55, modifierGroups: ["cheeseLettuce"] },
      { id: "mf-08", name: "鮪魚蛋", nameEn: "", price: 45, modifierGroups: ["cheeseLettuce"] },
      { id: "mf-09", name: "培根蛋", nameEn: "", price: 40, modifierGroups: ["cheeseLettuce"] },
      { id: "mf-10", name: "蔬菜蛋 (素)", nameEn: "", price: 40, modifierGroups: ["cheeseLettuce"] },
    ],
  },
  {
    category: "法式類",
    items: [
      // priceThin/priceThick, not a shared modifier group — the thick
      // delta isn't flat (some items don't offer it at all). See
      // PRICE_UNVERIFIED note at the top of this file.
      { id: "ft-01", name: "招牌肉排", nameEn: "", priceThin: 60, priceThick: null }, // PRICE_UNVERIFIED
      { id: "ft-02", name: "花生醬肉排", nameEn: "", priceThin: 70, priceThick: null }, // PRICE_UNVERIFIED
      { id: "ft-03", name: "榛果可可醬", nameEn: "", priceThin: 35, priceThick: 40 }, // PRICE_UNVERIFIED
      { id: "ft-04", name: "顆粒花生", nameEn: "", priceThin: 30, priceThick: 35 }, // PRICE_UNVERIFIED
      { id: "ft-05", name: "巧克力", nameEn: "", priceThin: 30, priceThick: 35 }, // PRICE_UNVERIFIED
      { id: "ft-06", name: "草莓", nameEn: "", priceThin: 30, priceThick: 35 }, // PRICE_UNVERIFIED
      { id: "ft-07", name: "煉乳", nameEn: "", priceThin: 30, priceThick: 35 }, // PRICE_UNVERIFIED
    ],
  },
  {
    category: "貝果類",
    items: [
      { id: "bgl-01", name: "生菜肉排", nameEn: "", price: 75, modifierGroups: ["cheeseEgg"] },
      { id: "bgl-02", name: "花生醬肉排", nameEn: "", price: 75, modifierGroups: ["cheeseEgg"] },
      { id: "bgl-03", name: "義式漢堡肉", nameEn: "", price: 75, modifierGroups: ["cheeseEgg"] },
      { id: "bgl-04", name: "生菜鮪魚", nameEn: "", price: 65, modifierGroups: ["cheeseEgg"] },
      { id: "bgl-05", name: "乾酪 (素)", nameEn: "", price: 50, modifierGroups: ["cheeseEgg"] },
      { id: "bgl-06", name: "藍莓乾酪", nameEn: "", price: 60, modifierGroups: ["cheeseEgg"] },
      { id: "bgl-07", name: "榛果可可醬", nameEn: "", price: 50, modifierGroups: ["cheeseEgg"] },
      { id: "bgl-08", name: "顆粒花生", nameEn: "", price: 50, modifierGroups: ["cheeseEgg"] },
      { id: "bgl-09", name: "巧克力", nameEn: "", price: 50, modifierGroups: ["cheeseEgg"] },
      { id: "bgl-10", name: "草莓", nameEn: "", price: 50, modifierGroups: ["cheeseEgg"] },
      { id: "bgl-11", name: "藍莓", nameEn: "", price: 50, modifierGroups: ["cheeseEgg"] },
      { id: "bgl-12", name: "奶酥", nameEn: "", price: 50, modifierGroups: ["cheeseEgg"] },
    ],
  },
  {
    category: "甜甜Der",
    items: [
      // priceThin/priceThick per item (see PRICE_UNVERIFIED note above)
      // plus the shared +棉花糖 marshmallow add-on on every item in
      // this category.
      { id: "sd-01", name: "榛果可可醬", nameEn: "", priceThin: 25, priceThick: 30, addons: SWEET_TOAST_MARSHMALLOW_ADDON }, // PRICE_UNVERIFIED
      { id: "sd-02", name: "顆粒花生", nameEn: "", priceThin: 25, priceThick: 30, addons: SWEET_TOAST_MARSHMALLOW_ADDON }, // PRICE_UNVERIFIED
      { id: "sd-03", name: "巧克力", nameEn: "", priceThin: 20, priceThick: 25, addons: SWEET_TOAST_MARSHMALLOW_ADDON }, // PRICE_UNVERIFIED
      { id: "sd-04", name: "草莓", nameEn: "", priceThin: 20, priceThick: 25, addons: SWEET_TOAST_MARSHMALLOW_ADDON }, // PRICE_UNVERIFIED
      { id: "sd-05", name: "藍莓", nameEn: "", priceThin: 20, priceThick: 25, addons: SWEET_TOAST_MARSHMALLOW_ADDON }, // PRICE_UNVERIFIED
      { id: "sd-06", name: "奶酥", nameEn: "", priceThin: 20, priceThick: 25, addons: SWEET_TOAST_MARSHMALLOW_ADDON }, // PRICE_UNVERIFIED
      { id: "sd-07", name: "煉乳", nameEn: "", priceThin: 20, priceThick: 25, addons: SWEET_TOAST_MARSHMALLOW_ADDON }, // PRICE_UNVERIFIED
      { id: "sd-08", name: "藍莓乾酪", nameEn: "", priceThin: 35, priceThick: null, addons: SWEET_TOAST_MARSHMALLOW_ADDON }, // PRICE_UNVERIFIED
      { id: "sd-09", name: "黃金蛋", nameEn: "", priceThin: 30, priceThick: null, addons: SWEET_TOAST_MARSHMALLOW_ADDON }, // PRICE_UNVERIFIED
    ],
  },
  {
    category: "軟法類",
    items: [
      { id: "sb-01", name: "生菜肉排", nameEn: "", price: 70, modifierGroups: ["cheeseEgg"] },
      { id: "sb-02", name: "義式漢堡肉", nameEn: "", price: 70, modifierGroups: ["cheeseEgg"] },
      { id: "sb-03", name: "生菜鮪魚", nameEn: "", price: 65, modifierGroups: ["cheeseEgg"] },
      { id: "sb-04", name: "生菜培根", nameEn: "", price: 60, modifierGroups: ["cheeseEgg"] },
      { id: "sb-05", name: "生菜雞柳", nameEn: "", price: 60, modifierGroups: ["cheeseEgg"] },
    ],
  },
  {
    category: "沙拉類",
    items: [
      { id: "sl-01", name: "輕食生菜肉排沙拉", nameEn: "", price: 60 },
      { id: "sl-02", name: "泰式雞肉沙拉", nameEn: "", price: 55 },
    ],
  },
  {
    category: "潛艇堡",
    items: [
      { id: "sm-01", name: "招牌肉排", nameEn: "", price: 65, modifierGroups: ["submarineSauce"] },
      { id: "sm-02", name: "德式香腸", nameEn: "", price: 60, modifierGroups: ["submarineSauce"] },
    ],
  },
  {
    category: "鐵板麵",
    items: [
      {
        id: "np-01",
        name: "特調鐵板麵",
        nameEn: "",
        price: 55,
        modifierGroups: ["noodleSpice"],
        addons: [
          { label: "荷包蛋", price: 10 },
          { label: "手作肉排", price: 20 },
          { label: "黃金泡菜", price: 20 },
          { label: "加麵", price: 10 },
        ],
      },
    ],
  },
  {
    category: "點心 / 炸物類",
    items: [
      { id: "sn-01", name: "熱狗 (3條)", nameEn: "", price: 20 },
      { id: "sn-02", name: "脆薯", nameEn: "", price: 30 },
      { id: "sn-03", name: "小雞塊", nameEn: "", price: 30 },
      { id: "sn-04", name: "檸檬雞柳", nameEn: "", price: 30 },
      { id: "sn-05", name: "德式香腸", nameEn: "", price: 30 },
      { id: "sn-06", name: "薯餅 (熱門)", nameEn: "", price: 25 },
      { id: "sn-07", name: "芋泥球", nameEn: "", price: 35 },
      { id: "sn-08", name: "肉來一片", nameEn: "", price: 30 },
      { id: "sn-09", name: "蘿蔔糕", nameEn: "", price: 35 },
      { id: "sn-10", name: "蘿蔔糕 + 蛋", nameEn: "", price: 45 },
      { id: "sn-11", name: "蘿蔔糕 + 肉", nameEn: "", price: 65 },
      { id: "sn-12", name: "蘿蔔糕 + 黃金泡菜", nameEn: "", price: 55 },
      { id: "sn-13", name: "煎餃", nameEn: "", price: 35 },
      { id: "sn-14", name: "荷包蛋", nameEn: "", price: 15, modifierGroups: ["eggDoneness"] },
      { id: "sn-15", name: "可樂餅", nameEn: "", price: 35 },
    ],
  },
  {
    category: "飲品",
    items: [
      { id: "dr-01", name: "美式咖啡（120oz）", nameEn: "", price: 45, modifierGroups: ["hotCold"] },
      { id: "dr-02", name: "拿鐵（120oz）", nameEn: "", price: 60, modifierGroups: ["hotCold"] },
      { id: "dr-03", name: "可可牛奶（120oz）", nameEn: "", price: 40, modifierGroups: ["hotCold"] },
      { id: "dr-04", name: "Tree Top 蘋果汁（120oz）", nameEn: "", price: 30, modifierGroups: ["hotCold"] },
      { id: "dr-05", name: "鮮奶茶（140oz）", nameEn: "", price: 35, modifierGroups: ["hotCold"] },
      { id: "dr-06", name: "非基改豆漿（140oz）", nameEn: "", price: 25, modifierGroups: ["hotCold"] },
      { id: "dr-07", name: "紅茶（140oz）", nameEn: "", price: 20, modifierGroups: ["hotCold"] },
      { id: "dr-08", name: "豆漿紅茶（140oz）", nameEn: "", price: 25, modifierGroups: ["hotCold"] },
    ],
  },
];

// Shop info shown at the top of the app
const SHOP_INFO = {
  name: "樂福",
  nameEn: "", // no English name given in the transcription — fill in if there is one
  pickupNote: "新鮮豬肉．手打嫩肉排",
};
