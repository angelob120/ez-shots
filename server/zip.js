// A zip written straight into the response, one photo at a time, so a 75
// photo high resolution download never sits in memory or on disk.
//
// Stored, not deflated: JPEGs do not get smaller, and storing costs no CPU.
// Each entry streams with a data descriptor (sizes and CRC after the bytes),
// which is what lets it start before the size of the photo is known. Zip64 is
// written when the archive passes 4 GB, which 75 JPEGs will not, but a big
// video would.
"use strict";

const zlib = require("node:zlib");

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

class ZipWriter {
  constructor(out) {
    this.out = out;
    this.offset = 0;
    this.entries = [];
  }

  write(buf) {
    this.offset += buf.length;
    return new Promise((resolve, reject) => {
      if (this.out.destroyed) return reject(new Error("client went away"));
      if (this.out.write(buf)) return resolve();
      const done = () => { this.out.off("drain", done); this.out.off("close", gone); resolve(); };
      const gone = () => { this.out.off("drain", done); this.out.off("close", gone); reject(new Error("client went away")); };
      this.out.on("drain", done);
      this.out.on("close", gone);
    });
  }

  // name: the path inside the zip. source: an async iterable of Buffers.
  async add(name, source, when = new Date()) {
    const nameBuf = Buffer.from(name, "utf8");
    const { time, date } = dosTime(when);
    const start = this.offset;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(45, 4);          // version needed, 4.5 for zip64
    head.writeUInt16LE(0x0808, 6);      // data descriptor + utf8 names
    head.writeUInt16LE(0, 8);           // stored
    head.writeUInt16LE(time, 10);
    head.writeUInt16LE(date, 12);
    // The crc is 0 here and comes in the descriptor. The sizes are maxed out
    // and given as 0 in a zip64 extra, which tells a reader the descriptor
    // after the bytes carries 64 bit sizes.
    head.writeUInt32LE(0xffffffff, 18);
    head.writeUInt32LE(0xffffffff, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(20, 28);
    const local64 = Buffer.alloc(20);
    local64.writeUInt16LE(0x0001, 0);
    local64.writeUInt16LE(16, 2);
    await this.write(head);
    await this.write(nameBuf);
    await this.write(local64);
    let crc = 0, size = 0;
    for await (const chunk of source) {
      crc = zlib.crc32(chunk, crc);
      size += chunk.length;
      await this.write(chunk);
    }
    const desc = Buffer.alloc(24);
    desc.writeUInt32LE(0x08074b50, 0);
    desc.writeUInt32LE(crc >>> 0, 4);
    desc.writeBigUInt64LE(BigInt(size), 8);
    desc.writeBigUInt64LE(BigInt(size), 16);
    await this.write(desc);
    this.entries.push({ nameBuf, crc, size, start, time, date });
  }

  async finish() {
    const cdStart = this.offset;
    for (const e of this.entries) {
      // Every central record carries a zip64 extra, so sizes and offsets past
      // 4 GB read right; readers use it only when the 32 bit field is maxed.
      const extra = Buffer.alloc(28);
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(e.size), 4);
      extra.writeBigUInt64LE(BigInt(e.size), 12);
      extra.writeBigUInt64LE(BigInt(e.start), 20);
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(45, 4);
      c.writeUInt16LE(45, 6);
      c.writeUInt16LE(0x0808, 8);
      c.writeUInt16LE(0, 10);
      c.writeUInt16LE(e.time, 12);
      c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc >>> 0, 16);
      c.writeUInt32LE(0xffffffff, 20);
      c.writeUInt32LE(0xffffffff, 24);
      c.writeUInt16LE(e.nameBuf.length, 28);
      c.writeUInt16LE(extra.length, 30);
      c.writeUInt32LE(0xffffffff, 42);
      await this.write(c);
      await this.write(e.nameBuf);
      await this.write(extra);
    }
    const cdSize = this.offset - cdStart;
    const z64 = this.offset;
    const rec = Buffer.alloc(56);
    rec.writeUInt32LE(0x06064b50, 0);
    rec.writeBigUInt64LE(44n, 4);
    rec.writeUInt16LE(45, 12);
    rec.writeUInt16LE(45, 14);
    rec.writeBigUInt64LE(BigInt(this.entries.length), 24);
    rec.writeBigUInt64LE(BigInt(this.entries.length), 32);
    rec.writeBigUInt64LE(BigInt(cdSize), 40);
    rec.writeBigUInt64LE(BigInt(cdStart), 48);
    await this.write(rec);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeBigUInt64LE(BigInt(z64), 8);
    loc.writeUInt32LE(1, 16);
    await this.write(loc);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Math.min(this.entries.length, 0xffff), 8);
    end.writeUInt16LE(Math.min(this.entries.length, 0xffff), 10);
    end.writeUInt32LE(0xffffffff, 12);
    end.writeUInt32LE(0xffffffff, 16);
    await this.write(end);
  }
}

module.exports = { ZipWriter };
