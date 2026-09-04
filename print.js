// ============================================================
// ESC/POS THERMAL PRINTER (via WebUSB)
// Works with most USB thermal receipt printers on Android Chrome.
// ============================================================

// ESC/POS command bytes
const ESC = 0x1b;
const GS = 0x1d;

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

function textToBytes(str) {
  // Thermal printers commonly expect a single-byte encoding.
  // For Chinese characters, most receipt printers need GB18030/Big5
  // codepage switching, which varies by printer model. If Chinese
  // text prints as garbage, check your printer's manual for the
  // correct codepage command to send before printing — ask me and
  // I can adjust this function for your specific printer model.
  return new TextEncoder().encode(str);
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

// Builds the receipt as a flat list of {text, align, bold} lines —
// the single source of truth for both the real ESC/POS print
// (buildReceipt, below) and the on-screen preview in staff.html
// (ThermalPrinter.buildReceiptPreview), so the two can't drift apart.
function buildReceiptModel(order) {
  const divider = "-".repeat(CHARS_PER_LINE);
  const lines = [];

  lines.push({ text: order.shopName, align: "center", bold: true });
  lines.push({ text: divider, align: "left", bold: false });

  order.items.forEach((item) => {
    const label = item.modifiers ? `${item.name}(${item.modifiers})` : item.name;
    lines.push({
      text: padColumns(`${label} x${item.qty}`, `$${item.subtotal}`, CHARS_PER_LINE),
      align: "left",
      bold: false,
    });
  });

  lines.push({ text: divider, align: "left", bold: false });
  lines.push({ text: padColumns("Total", `NT$${order.total}`, CHARS_PER_LINE), align: "left", bold: true });

  if (order.note) {
    lines.push({ text: `Note: ${order.note}`, align: "left", bold: false });
  }

  lines.push({ text: `Order #${order.shortId}   ${order.time}`, align: "left", bold: false });

  return lines;
}

function buildReceipt(order) {
  const bytes = [];
  const push = (...arr) => bytes.push(...arr);
  const pushText = (str) => push(...textToBytes(str));

  push(ESC, 0x40); // initialize printer — also resets align/bold to defaults

  // Track current align/bold state and only emit a command when a
  // line's style actually differs from it — e.g. the header's
  // center+bold can't bleed into the item list, because the first
  // item line's {align:"left", bold:false} always emits an explicit
  // reset rather than assuming a prior reset already happened.
  let currentAlign = "left";
  let currentBold = false;

  buildReceiptModel(order).forEach((line) => {
    if (line.align !== currentAlign) {
      push(ESC, 0x61, line.align === "center" ? 0x01 : 0x00);
      currentAlign = line.align;
    }
    if (line.bold !== currentBold) {
      push(ESC, 0x45, line.bold ? 0x01 : 0x00);
      currentBold = line.bold;
    }
    pushText(line.text + "\n");
  });

  // Explicit reset before the trailing feed/cut too, so whatever
  // prints next (this printer or another job) starts from defaults
  // rather than inheriting the last line's style.
  push(ESC, 0x61, 0x00);
  push(ESC, 0x45, 0x00);

  push(ESC, 0x64, FEED_LINES_BEFORE_CUT); // feed blank lines to clear the cutter before cutting
  push(GS, 0x56, 0x00); // full cut

  return new Uint8Array(bytes);
}

let printerDevice = null;

async function connectPrinter() {
  // Chrome will show a device picker limited to KNOWN_PRINTERS above.
  // The user selects their thermal printer once; the browser
  // remembers permission for that device on this site.
  printerDevice = await navigator.usb.requestDevice({ filters: KNOWN_PRINTERS });
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

async function printOrder(order) {
  if (!navigator.usb) {
    throw new Error("WebUSB not supported — use Chrome on Android.");
  }
  if (!printerDevice) {
    await connectPrinter();
  }

  const data = buildReceipt(order);

  // Re-derive the OUT endpoint rather than caching it from
  // connectPrinter() — cheap, and avoids relying on state surviving
  // between the two calls. See connectPrinter()'s console.log for
  // this printer's actual interface/endpoint numbers.
  const iface = printerDevice.configuration.interfaces[0];
  const endpoint = iface.alternate.endpoints.find((e) => e.direction === "out");

  await printerDevice.transferOut(endpoint.endpointNumber, data);
}

// Exposed globally for staff.js to call. CHARS_PER_LINE and
// buildReceiptPreview let staff.html render an on-screen preview from
// the exact same layout logic as the real print, without needing a
// physical printer to check spacing/alignment changes.
window.ThermalPrinter = {
  connectPrinter,
  printOrder,
  buildReceiptPreview: buildReceiptModel,
  CHARS_PER_LINE,
};
