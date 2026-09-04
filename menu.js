// ============================================================
// MENU DATA
// Edit this file to change what's for sale. No coding needed
// beyond copying this pattern — just add or remove items.
// ============================================================

const MENU = [
  {
    category: "蛋餅 Egg Crepes",
    items: [
      { id: "eg-01", name: "原味蛋餅", nameEn: "Plain Egg Crepe", price: 30 },
      { id: "eg-02", name: "起司蛋餅", nameEn: "Cheese Egg Crepe", price: 35 },
      { id: "eg-03", name: "培根蛋餅", nameEn: "Bacon Egg Crepe", price: 40 },
    ],
  },
  {
    category: "三明治 Sandwiches",
    items: [
      { id: "sw-01", name: "總匯三明治", nameEn: "Club Sandwich", price: 45 },
      { id: "sw-02", name: "鮪魚三明治", nameEn: "Tuna Sandwich", price: 40 },
    ],
  },
  {
    category: "飲料 Drinks",
    items: [
      { id: "dr-01", name: "豆漿", nameEn: "Soy Milk", price: 20 },
      { id: "dr-02", name: "紅茶", nameEn: "Black Tea", price: 20 },
      { id: "dr-03", name: "奶茶", nameEn: "Milk Tea", price: 25 },
    ],
  },
];

// Shop info shown at the top of the app
const SHOP_INFO = {
  name: "早安豆漿店",
  nameEn: "Morning Soy Milk Shop",
  pickupNote: "點餐後請於 15-20 分鐘後到店取餐",
};
