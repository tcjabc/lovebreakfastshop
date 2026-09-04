// ============================================================
// ESC/POS THERMAL PRINTER (via WebUSB)
// Works with most USB thermal receipt printers on Android Chrome.
// ============================================================

// ESC/POS command bytes
const ESC = 0x1b;
const GS = 0x1d;

function textToBytes(str) {
  // Thermal printers commonly expect a single-byte encoding.
  // For Chinese characters, most receipt printers need GB18030/Big5
  // codepage switching, which varies by printer model. If Chinese
  // text prints as garbage, check your printer's manual for the
  // correct codepage command to send before printing — ask me and
  // I can adjust this function for your specific printer model.
  return new TextEncoder().encode(str);
}

function buildReceipt(order) {
  const bytes = [];

  const push = (...arr) => bytes.push(...arr);
  const pushText = (str) => push(...textToBytes(str));

  push(ESC, 0x40); // initialize printer

  // Center + bold shop name
  push(ESC, 0x61, 0x01); // center align
  push(ESC, 0x45, 0x01); // bold on
  pushText(order.shopName + "\n");
  push(ESC, 0x45, 0x00); // bold off
  pushText("------------------------------\n");

  // Left align for items
  push(ESC, 0x61, 0x00);
  order.items.forEach((item) => {
    const label = item.modifiers ? `${item.name}(${item.modifiers})` : item.name;
    pushText(`${label} x${item.qty}`.padEnd(22) + `$${item.subtotal}\n`);
  });

  pushText("------------------------------\n");
  push(ESC, 0x45, 0x01);
  pushText(`Total: NT$${order.total}\n`);
  push(ESC, 0x45, 0x00);

  if (order.note) {
    pushText(`Note: ${order.note}\n`);
  }

  pushText(`Order #${order.shortId}   ${order.time}\n`);
  pushText("\n\n\n");

  push(GS, 0x56, 0x00); // full cut

  return new Uint8Array(bytes);
}

let printerDevice = null;

async function connectPrinter() {
  // Chrome will show a device picker limited to USB devices.
  // The user selects their thermal printer once; the browser
  // remembers permission for that device on this site.
  printerDevice = await navigator.usb.requestDevice({ filters: [] });
  await printerDevice.open();
  if (printerDevice.configuration === null) {
    await printerDevice.selectConfiguration(1);
  }
  await printerDevice.claimInterface(0);
  return printerDevice;
}

async function printOrder(order) {
  if (!navigator.usb) {
    throw new Error("WebUSB not supported — use Chrome on Android.");
  }
  if (!printerDevice) {
    await connectPrinter();
  }

  const data = buildReceipt(order);

  // Find the OUT endpoint (varies slightly by printer; endpoint 1 is
  // the common default for USB thermal printers)
  const iface = printerDevice.configuration.interfaces[0];
  const endpoint = iface.alternate.endpoints.find((e) => e.direction === "out");

  await printerDevice.transferOut(endpoint.endpointNumber, data);
}

// Exposed globally for staff.js to call
window.ThermalPrinter = { connectPrinter, printOrder };
