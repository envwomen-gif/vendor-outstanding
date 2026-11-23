import * as CFB from "cfb";
import type { Cell } from "@/lib/outstanding/parse";

/**
 * Reader for the old Excel format (.xls, BIFF8). JS1 makes its exports in this format.
 * It reads the first worksheet: text, numbers and dates. It reads values only: no formats,
 * no styles, no macros. Nothing in the file is run.
 */

export class XlsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsError";
  }
}

const MAX_ROWS = 200_000;
const MAX_COLUMNS = 1_024;

// Record types (BIFF8).
const BOF = 0x0809;
const EOF = 0x000a;
const CONTINUE = 0x003c;
const FILEPASS = 0x002f;
const DATEMODE = 0x0022;
const BOUNDSHEET = 0x0085;
const XF = 0x00e0;
const FORMAT = 0x041e;
const SST = 0x00fc;
const LABELSST = 0x00fd;
const LABEL = 0x0204;
const NUMBER = 0x0203;
const RK = 0x027e;
const MULRK = 0x00bd;
const FORMULA = 0x0006;
const STRING = 0x0207;
const BOOLERR = 0x0205;

interface Record {
  readonly type: number;
  readonly data: Uint8Array;
}

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

/** All records of a stream, from `start` to the end of the substream that begins there. */
function* records(stream: Uint8Array, start: number): Generator<Record> {
  let position = start;
  let depth = 0;
  while (position + 4 <= stream.length) {
    const dv = view(stream.subarray(position, position + 4));
    const type = dv.getUint16(0, true);
    const length = dv.getUint16(2, true);
    const end = position + 4 + length;
    if (end > stream.length) throw new XlsError("The .xls file is damaged (a record is cut).");
    yield { type, data: stream.subarray(position + 4, end) };
    position = end;
    if (type === BOF) depth += 1;
    if (type === EOF) {
      depth -= 1;
      if (depth <= 0) return;
    }
  }
}

// ----- strings -----

/** Reads bytes over a list of chunks. A string in the shared string table can cross a chunk. */
class ChunkReader {
  private chunk = 0;
  private offset = 0;

  constructor(private readonly chunks: readonly Uint8Array[]) {}

  private current(): Uint8Array | undefined {
    while (this.chunk < this.chunks.length && this.offset >= (this.chunks[this.chunk]?.length ?? 0)) {
      this.chunk += 1;
      this.offset = 0;
    }
    return this.chunks[this.chunk];
  }

  hasMore(): boolean {
    return this.current() !== undefined;
  }

  u8(): number {
    const c = this.current();
    if (!c) throw new XlsError("The .xls file is damaged (the string table is cut).");
    const value = c[this.offset] as number;
    this.offset += 1;
    return value;
  }

  u16(): number {
    return this.u8() | (this.u8() << 8);
  }

  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }

  skip(count: number): void {
    let left = count;
    while (left > 0) {
      const c = this.current();
      if (!c) throw new XlsError("The .xls file is damaged (the string table is cut).");
      const step = Math.min(left, c.length - this.offset);
      this.offset += step;
      left -= step;
    }
  }

  /** True when the current chunk has no more bytes, so the next read starts a new chunk. */
  private exhausted(): boolean {
    const c = this.chunks[this.chunk];
    return c !== undefined && this.offset >= c.length;
  }

  /**
   * Reads `count` characters. When the characters go on in a new chunk, the first byte of that
   * chunk says if the characters have 1 or 2 bytes.
   */
  chars(count: number, wideAtStart: boolean): string {
    let wide = wideAtStart;
    let text = "";
    let left = count;
    let needFlag = left > 0 && this.exhausted();
    while (left > 0) {
      if (needFlag) {
        wide = (this.u8() & 1) === 1;
        needFlag = false;
      }
      const c = this.current();
      if (!c) throw new XlsError("The .xls file is damaged (the string table is cut).");
      const size = wide ? 2 : 1;
      const available = Math.floor((c.length - this.offset) / size);
      if (available === 0) {
        // The rest of this chunk cannot hold a character: the string goes on in the next chunk.
        this.chunk += 1;
        this.offset = 0;
        needFlag = true;
        continue;
      }
      const take = Math.min(left, available);
      for (let i = 0; i < take; i += 1) text += String.fromCharCode(wide ? this.u16() : this.u8());
      left -= take;
      if (left > 0) needFlag = true;
    }
    return text;
  }
}

/** A string with a 16-bit length, as in the shared string table, FORMAT and LABEL records. */
function readUnicodeString(reader: ChunkReader): string {
  const length = reader.u16();
  const flags = reader.u8();
  const runs = flags & 0x08 ? reader.u16() : 0;
  const extra = flags & 0x04 ? reader.u32() : 0;
  const text = reader.chars(length, (flags & 0x01) === 1);
  reader.skip(runs * 4 + extra);
  return text;
}

function parseSst(chunks: readonly Uint8Array[]): string[] {
  const reader = new ChunkReader(chunks);
  reader.u32(); // total count
  const unique = reader.u32();
  const strings: string[] = [];
  for (let i = 0; i < unique && reader.hasMore(); i += 1) strings.push(readUnicodeString(reader));
  return strings;
}

// ----- numbers and dates -----

function decodeRk(rk: number): number {
  let value: number;
  if (rk & 0x02) {
    value = rk >> 2; // 30-bit signed integer
  } else {
    const buffer = new DataView(new ArrayBuffer(8));
    buffer.setUint32(4, (rk & 0xfffffffc) >>> 0, true);
    value = buffer.getFloat64(0, true);
  }
  return rk & 0x01 ? value / 100 : value;
}

const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormat(id: number, custom: ReadonlyMap<number, string>): boolean {
  if (BUILT_IN_DATE_FORMATS.has(id)) return true;
  const text = custom.get(id);
  if (text === undefined) return false;
  const stripped = text.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[dmyhs]/i.test(stripped);
}

function serialToDate(serial: number, mode1904: boolean): Date {
  const day = 86_400_000;
  if (mode1904) return new Date(Date.UTC(1904, 0, 1) + Math.round(serial * day));
  // Excel counts 29-Feb-1900, which did not exist. Serial numbers below 61 are one day off.
  const base = serial < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  return new Date(base + Math.round(serial * day));
}

// ----- the reader -----

export function readXls(bytes: Uint8Array): Cell[][] {
  let container: CFB.CFB$Container;
  try {
    container = CFB.read(bytes as unknown as Buffer, { type: "buffer" });
  } catch {
    throw new XlsError("The file is not a valid .xls file.");
  }
  const entry = CFB.find(container, "/Workbook") ?? CFB.find(container, "/Book");
  if (!entry?.content) throw new XlsError("The .xls file has no workbook.");
  const stream = Uint8Array.from(entry.content as ArrayLike<number>);

  // ----- globals -----
  const sharedStrings: string[] = [];
  const xfFormats: number[] = [];
  const customFormats = new Map<number, string>();
  let mode1904 = false;
  let sheetPosition: number | undefined;
  let sawBof = false;

  const globalRecords = [...records(stream, 0)];
  for (let i = 0; i < globalRecords.length; i += 1) {
    const rec = globalRecords[i] as Record;
    const dv = view(rec.data);
    switch (rec.type) {
      case BOF:
        if (!sawBof) {
          sawBof = true;
          if (dv.getUint16(0, true) !== 0x0600) {
            throw new XlsError("This .xls file is too old (before Excel 97). Save it as .xlsx or .csv.");
          }
        }
        break;
      case FILEPASS:
        throw new XlsError("The .xls file has a password. Remove the password and try again.");
      case DATEMODE:
        mode1904 = dv.getUint16(0, true) === 1;
        break;
      case BOUNDSHEET:
        if (sheetPosition === undefined && rec.data[5] === 0) sheetPosition = dv.getUint32(0, true);
        break;
      case XF:
        xfFormats.push(dv.getUint16(2, true));
        break;
      case FORMAT: {
        const reader = new ChunkReader([rec.data.subarray(2)]);
        customFormats.set(dv.getUint16(0, true), readUnicodeString(reader));
        break;
      }
      case SST: {
        const chunks: Uint8Array[] = [rec.data];
        while ((globalRecords[i + 1] as Record | undefined)?.type === CONTINUE) {
          i += 1;
          chunks.push((globalRecords[i] as Record).data);
        }
        sharedStrings.push(...parseSst(chunks));
        break;
      }
      default:
        break;
    }
  }
  if (!sawBof) throw new XlsError("The file is not a valid .xls file.");
  if (sheetPosition === undefined) throw new XlsError("The .xls file has no worksheet.");

  const dateXf = xfFormats.map((id) => isDateFormat(id, customFormats));

  // ----- first worksheet -----
  const cells = new Map<number, Map<number, Cell>>();
  let maxRow = -1;
  let maxColumn = -1;
  const put = (row: number, column: number, value: Cell) => {
    if (row >= MAX_ROWS || column >= MAX_COLUMNS) throw new XlsError("The .xls sheet is too large.");
    let line = cells.get(row);
    if (!line) {
      line = new Map();
      cells.set(row, line);
    }
    line.set(column, value);
    if (row > maxRow) maxRow = row;
    if (column > maxColumn) maxColumn = column;
  };
  const number = (xf: number, value: number): Cell => (dateXf[xf] ? serialToDate(value, mode1904) : value);

  let pendingFormula: { row: number; column: number } | undefined;
  for (const rec of records(stream, sheetPosition)) {
    const dv = view(rec.data);
    switch (rec.type) {
      case LABELSST: {
        const text = sharedStrings[dv.getUint32(6, true)];
        put(dv.getUint16(0, true), dv.getUint16(2, true), text ?? "");
        break;
      }
      case LABEL: {
        const reader = new ChunkReader([rec.data.subarray(6)]);
        put(dv.getUint16(0, true), dv.getUint16(2, true), readUnicodeString(reader));
        break;
      }
      case NUMBER:
        put(dv.getUint16(0, true), dv.getUint16(2, true), number(dv.getUint16(4, true), dv.getFloat64(6, true)));
        break;
      case RK:
        put(dv.getUint16(0, true), dv.getUint16(2, true), number(dv.getUint16(4, true), decodeRk(dv.getUint32(6, true))));
        break;
      case MULRK: {
        const row = dv.getUint16(0, true);
        const first = dv.getUint16(2, true);
        const count = Math.floor((rec.data.length - 6) / 6);
        for (let k = 0; k < count; k += 1) {
          const at = 4 + k * 6;
          put(row, first + k, number(dv.getUint16(at, true), decodeRk(dv.getUint32(at + 2, true))));
        }
        break;
      }
      case BOOLERR:
        if (rec.data[7] === 0) put(dv.getUint16(0, true), dv.getUint16(2, true), rec.data[6] === 1);
        break;
      case FORMULA: {
        const row = dv.getUint16(0, true);
        const column = dv.getUint16(2, true);
        if (rec.data[12] === 0xff && rec.data[13] === 0xff) {
          const kind = rec.data[6];
          if (kind === 0) pendingFormula = { row, column }; // the text is in the next STRING record
          else if (kind === 1) put(row, column, rec.data[8] === 1);
          else if (kind === 3) put(row, column, "");
        } else {
          put(row, column, number(dv.getUint16(4, true), dv.getFloat64(6, true)));
        }
        break;
      }
      case STRING:
        if (pendingFormula) {
          const reader = new ChunkReader([rec.data]);
          put(pendingFormula.row, pendingFormula.column, readUnicodeString(reader));
          pendingFormula = undefined;
        }
        break;
      default:
        break;
    }
  }

  const rows: Cell[][] = [];
  for (let r = 0; r <= maxRow; r += 1) {
    const line = cells.get(r);
    const out: Cell[] = new Array<Cell>(maxColumn + 1).fill(null);
    if (line) for (const [c, value] of line) out[c] = value;
    rows.push(out);
  }
  return rows;
}
