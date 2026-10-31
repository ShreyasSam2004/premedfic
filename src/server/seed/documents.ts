/**
 * Synthetic evidence documents for the demo, seed, evaluation fixtures, and
 * end-to-end tests. All content is fictional.
 */
import zlib from "node:zlib";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export interface InvoiceSpec {
  contractor: string;
  license: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  completionDate: string | null;
  permitNumber: string | null;
  jobSite: string;
  ownerName: string;
  lines: [string, number][];
  extraText?: string[];
}

export async function invoicePdf(spec: InvoiceSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 740;
  const line = (text: string, opts: { size?: number; b?: boolean; x?: number } = {}) => {
    page.drawText(text, { x: opts.x ?? 60, y, size: opts.size ?? 11, font: opts.b ? bold : font, color: rgb(0.1, 0.1, 0.12) });
    y -= (opts.size ?? 11) + 7;
  };
  line(spec.contractor, { size: 18, b: true });
  if (spec.license) line(`License #: ${spec.license}`);
  line("INVOICE", { size: 14, b: true });
  y -= 6;
  line(`Invoice Number: ${spec.invoiceNumber}`);
  line(`Invoice Date: ${spec.invoiceDate}`);
  line(`Bill To: ${spec.ownerName}`);
  line(`Job Site: ${spec.jobSite}`);
  if (spec.permitNumber) line(`Permit #: ${spec.permitNumber}`);
  if (spec.completionDate) line(`Date of Completion: ${spec.completionDate}`);
  y -= 8;
  line("Description of work", { b: true });
  let total = 0;
  for (const [desc, amount] of spec.lines) {
    total += amount;
    line(`${desc}   $${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  }
  y -= 6;
  line(`Total: $${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, { b: true });
  line("Amount Due: $0.00 (paid in full)");
  for (const t of spec.extraText ?? []) line(t, { size: 9 });
  y -= 10;
  line("Thank you for your business.", { size: 9 });
  return doc.save();
}

export async function letterPdf(title: string, paragraphs: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let y = 730;
  page.drawText(title, { x: 60, y, size: 14, font: await doc.embedFont(StandardFonts.HelveticaBold) });
  y -= 30;
  for (const p of paragraphs) {
    const words = p.split(" ");
    let current = "";
    for (const w of words) {
      if (font.widthOfTextAtSize(`${current} ${w}`, 11) > 490) {
        page.drawText(current.trim(), { x: 60, y, size: 11, font });
        y -= 16;
        current = w;
      } else current += ` ${w}`;
    }
    page.drawText(current.trim(), { x: 60, y, size: 11, font });
    y -= 26;
  }
  return doc.save();
}

/** A PDF whose only content is a drawn image-like pattern: no text layer (simulates a scan). */
export async function scannedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  for (let i = 0; i < 40; i++) page.drawRectangle({ x: 60, y: 700 - i * 15, width: 300 + ((i * 37) % 180), height: 6, color: rgb(0.5, 0.5, 0.5) });
  return doc.save();
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder (no image dependencies)
// ---------------------------------------------------------------------------

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** Generates a stylized "photo" (roof shingles / fence / generic) as PNG bytes. */
export function photoPng(kind: "roof" | "fence" | "window" | "unit" | "panel", seed = 1, size = 320): Uint8Array {
  const w = size;
  const h = Math.round(size * 0.75);
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0;
      const sky = y < h * 0.3;
      if (kind === "roof") {
        const row = Math.floor((y - h * 0.3) / 14);
        const offset = row % 2 ? 12 : 0;
        const shingleEdge = (x + offset) % 24 < 2 || (y - h * 0.3) % 14 < 2;
        [r, g, b] = sky ? [150 + seed * 3, 190, 230] : shingleEdge ? [40, 40, 45] : [85 + ((x * 7 + y * 3 + seed) % 20), 80, 78];
      } else if (kind === "fence") {
        const picket = x % 30 < 20 && y > h * 0.35;
        [r, g, b] = sky ? [160, 200, 235] : picket ? [235, 230, 215] : [90, 140, 70];
      } else if (kind === "window") {
        const frame = x % 120 < 8 || y % 110 < 8;
        [r, g, b] = frame ? [245, 245, 245] : [120, 160, 190 + (x % 30)];
      } else if (kind === "panel") {
        const breaker = x > w * 0.3 && x < w * 0.7 && (y % 18 < 12);
        [r, g, b] = breaker ? [30, 30, 30] : [170, 172, 175];
      } else {
        const cyl = Math.abs(x - w / 2) < w * 0.18 && y > h * 0.15;
        [r, g, b] = cyl ? [210, 210, 205] : [140, 130, 120];
      }
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return new Uint8Array(png);
}

/** An executable-looking file disguised with a .pdf name (must be rejected). */
export function disguisedExecutable(): Uint8Array {
  return new Uint8Array(Buffer.concat([Buffer.from("MZ\x90\x00\x03\x00\x00\x00", "latin1"), Buffer.alloc(256, 0x41)]));
}

/** A PDF with an embedded JavaScript action (must be rejected). */
export function pdfWithJavascript(): Uint8Array {
  const body = "%PDF-1.4\n1 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert('x')) >> >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF";
  return new Uint8Array(Buffer.from(body, "latin1"));
}
