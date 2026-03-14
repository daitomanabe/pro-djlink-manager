const net = require("net");

const REMOTEDB_MAGIC = 0x872349ae;
const REMOTEDB_QUERY_PORT = 12523;

const FIELD_TYPE = {
  UInt8: 0x0f,
  UInt16: 0x10,
  UInt32: 0x11,
  Binary: 0x14,
  String: 0x26,
};

const ARGUMENT_TYPE = {
  UInt32: 0x06,
  Binary: 0x03,
  String: 0x02,
};

const MESSAGE_TYPE = {
  Introduce: 0x0000,
  Disconnect: 0x0100,
  RenderMenu: 0x3000,
  GetMetadata: 0x2002,
  GetArtwork: 0x2003,
  GetWaveformPreview: 0x2004,
  GetTrackInfo: 0x2102,
  GetGenericMetadata: 0x2202,
  GetCueAndLoops: 0x2104,
  GetBeatGrid: 0x2204,
  GetWaveformDetailed: 0x2904,
  GetAdvCueAndLoops: 0x2b04,
  GetWaveformHD: 0x2c04,
  Success: 0x4000,
  MenuHeader: 0x4001,
  Artwork: 0x4002,
  Error: 0x4003,
  MenuItem: 0x4101,
  MenuFooter: 0x4201,
  BeatGrid: 0x4602,
  CueAndLoop: 0x4702,
  WaveformPreview: 0x4402,
  WaveformDetailed: 0x4a02,
  AdvCueAndLoops: 0x4e02,
  WaveformHD: 0x4f02,
};

const ITEM_TYPE = {
  Path: 0,
  AlbumTitle: 2,
  TrackTitle: 4,
  Genre: 6,
  Artist: 7,
  Rating: 10,
  Duration: 11,
  Tempo: 13,
  Label: 14,
  Key: 15,
  BitRate: 16,
  Year: 17,
  ColorNone: 19,
  ColorPink: 20,
  ColorRed: 21,
  ColorOrange: 22,
  ColorYellow: 23,
  ColorGreen: 24,
  ColorAqua: 25,
  ColorBlue: 26,
  ColorPurple: 27,
  Comment: 35,
};

const COLOR_TYPE = {
  none: ITEM_TYPE.ColorNone,
  pink: ITEM_TYPE.ColorPink,
  red: ITEM_TYPE.ColorRed,
  orange: ITEM_TYPE.ColorOrange,
  yellow: ITEM_TYPE.ColorYellow,
  green: ITEM_TYPE.ColorGreen,
  aqua: ITEM_TYPE.ColorAqua,
  blue: ITEM_TYPE.ColorBlue,
  purple: ITEM_TYPE.ColorPurple,
};

function encodeUInt8(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt8(FIELD_TYPE.UInt8, 0);
  buffer.writeUInt8(value & 0xff, 1);
  return buffer;
}

function encodeUInt16(value) {
  const buffer = Buffer.alloc(3);
  buffer.writeUInt8(FIELD_TYPE.UInt16, 0);
  buffer.writeUInt16BE(value & 0xffff, 1);
  return buffer;
}

function encodeUInt32(value) {
  const buffer = Buffer.alloc(5);
  buffer.writeUInt8(FIELD_TYPE.UInt32, 0);
  buffer.writeUInt32BE(value >>> 0, 1);
  return buffer;
}

function encodeBinary(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const header = Buffer.alloc(5);
  header.writeUInt8(FIELD_TYPE.Binary, 0);
  header.writeUInt32BE(data.length, 1);
  return Buffer.concat([header, data]);
}

function encodeString(value) {
  const data = Buffer.from(`${value || ""}\0`, "utf16le").swap16();
  const header = Buffer.alloc(5);
  header.writeUInt8(FIELD_TYPE.String, 0);
  header.writeUInt32BE(data.length / 2, 1);
  return Buffer.concat([header, data]);
}

function encodeMessage(type, transactionId, args = []) {
  const argTypeList = Buffer.alloc(12, 0x00);
  const encodedArgs = [];

  args.forEach((arg, index) => {
    if (!arg || !arg.kind) {
      throw new Error(`Invalid remote db argument at index ${index}.`);
    }

    if (arg.kind === "u8") {
      argTypeList[index] = 0x00;
      encodedArgs.push(encodeUInt8(arg.value));
      return;
    }
    if (arg.kind === "u16") {
      argTypeList[index] = 0x00;
      encodedArgs.push(encodeUInt16(arg.value));
      return;
    }
    if (arg.kind === "u32") {
      argTypeList[index] = ARGUMENT_TYPE.UInt32;
      encodedArgs.push(encodeUInt32(arg.value));
      return;
    }
    if (arg.kind === "string") {
      argTypeList[index] = ARGUMENT_TYPE.String;
      encodedArgs.push(encodeString(arg.value));
      return;
    }
    if (arg.kind === "binary") {
      argTypeList[index] = ARGUMENT_TYPE.Binary;
      encodedArgs.push(encodeBinary(arg.value));
      return;
    }

    throw new Error(`Unsupported remote db argument kind: ${arg.kind}`);
  });

  return Buffer.concat([
    encodeUInt32(REMOTEDB_MAGIC),
    encodeUInt32(transactionId),
    encodeUInt16(type),
    encodeUInt8(args.length),
    encodeBinary(argTypeList),
    ...encodedArgs,
  ]);
}

class BufferedSocketReader {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.closed = false;
    this.error = null;
    this.waiters = [];

    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.flush();
    });

    socket.on("end", () => {
      this.closed = true;
      this.flush();
    });

    socket.on("close", () => {
      this.closed = true;
      this.flush();
    });

    socket.on("error", (error) => {
      this.error = error;
      this.closed = true;
      this.flush();
    });
  }

  flush() {
    while (this.waiters.length) {
      const next = this.waiters[0];
      if (this.error) {
        this.waiters.shift();
        next.reject(this.error);
        continue;
      }
      if (this.buffer.length >= next.bytes) {
        const chunk = this.buffer.subarray(0, next.bytes);
        this.buffer = this.buffer.subarray(next.bytes);
        this.waiters.shift();
        next.resolve(chunk);
        continue;
      }
      if (this.closed) {
        this.waiters.shift();
        next.reject(new Error("Remote DB socket closed."));
        continue;
      }
      break;
    }
  }

  read(bytes) {
    if (this.error) {
      return Promise.reject(this.error);
    }
    if (this.buffer.length >= bytes) {
      const chunk = this.buffer.subarray(0, bytes);
      this.buffer = this.buffer.subarray(bytes);
      return Promise.resolve(chunk);
    }
    if (this.closed) {
      return Promise.reject(new Error("Remote DB socket closed."));
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ bytes, resolve, reject });
      this.flush();
    });
  }
}

async function readField(reader, expectedType) {
  const typeBuffer = await reader.read(1);
  const type = typeBuffer.readUInt8(0);
  if (expectedType != null && type !== expectedType) {
    throw new Error(`Expected field type 0x${expectedType.toString(16)}, got 0x${type.toString(16)}.`);
  }

  if (type === FIELD_TYPE.UInt8) {
    return { type, value: (await reader.read(1)).readUInt8(0) };
  }
  if (type === FIELD_TYPE.UInt16) {
    return { type, value: (await reader.read(2)).readUInt16BE(0) };
  }
  if (type === FIELD_TYPE.UInt32) {
    return { type, value: (await reader.read(4)).readUInt32BE(0) };
  }
  if (type === FIELD_TYPE.Binary) {
    const length = (await reader.read(4)).readUInt32BE(0);
    return { type, value: length ? await reader.read(length) : Buffer.alloc(0) };
  }
  if (type === FIELD_TYPE.String) {
    const charLength = (await reader.read(4)).readUInt32BE(0);
    const raw = charLength ? await reader.read(charLength * 2) : Buffer.alloc(0);
    const value = raw.length ? Buffer.from(raw).swap16().slice(0, -2).toString("utf16le") : "";
    return { type, value };
  }

  throw new Error(`Unsupported remote db field type 0x${type.toString(16)}.`);
}

async function readMessage(reader) {
  const magic = await readField(reader, FIELD_TYPE.UInt32);
  if (magic.value !== REMOTEDB_MAGIC) {
    throw new Error(`Unexpected remote db magic 0x${magic.value.toString(16)}.`);
  }

  const transactionId = await readField(reader, FIELD_TYPE.UInt32);
  const type = await readField(reader, FIELD_TYPE.UInt16);
  const argCount = await readField(reader, FIELD_TYPE.UInt8);
  const argList = await readField(reader, FIELD_TYPE.Binary);
  const args = [];

  for (let index = 0; index < argCount.value; index += 1) {
    const argumentType = argList.value[index];
    if (argumentType === ARGUMENT_TYPE.UInt32) {
      args.push(await readField(reader, FIELD_TYPE.UInt32));
      continue;
    }
    if (argumentType === ARGUMENT_TYPE.String) {
      args.push(await readField(reader, FIELD_TYPE.String));
      continue;
    }
    if (argumentType === ARGUMENT_TYPE.Binary) {
      args.push(await readField(reader, FIELD_TYPE.Binary));
      continue;
    }
    throw new Error(`Unsupported remote db argument type 0x${argumentType.toString(16)}.`);
  }

  return {
    transactionId: transactionId.value,
    type: type.value,
    args,
  };
}

function write(socket, buffer) {
  return new Promise((resolve, reject) => {
    socket.write(buffer, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function colorItemType(colorName) {
  return COLOR_TYPE[`${colorName || "blue"}`.trim().toLowerCase()] || ITEM_TYPE.ColorBlue;
}

function buildTrackRecord(trackId, runtimeState) {
  const matchedDeck = runtimeState.decks.find((deck) => deck.trackId === trackId) || runtimeState.decks.find((deck) => deck.trackId > 0) || null;

  if (!matchedDeck) {
    return {
      id: trackId,
      title: `Track ${trackId}`,
      artist: "Unknown Artist",
      album: "Emulated Album",
      genre: "Electronic",
      comment: "",
      label: "",
      keyLabel: "",
      color: "blue",
      rating: 0,
      year: new Date().getUTCFullYear(),
      bitrate: 320,
      durationSeconds: 0,
      tempo: 0,
      artworkId: 0,
      path: `/USB/Track-${trackId}.wav`,
    };
  }

  return {
    id: trackId,
    title: matchedDeck.title || `Track ${trackId}`,
    artist: matchedDeck.artist || "Unknown Artist",
    album: matchedDeck.album || "Emulated Album",
    genre: matchedDeck.genre || "Electronic",
    comment: matchedDeck.comment || "",
    label: matchedDeck.label || "",
    keyLabel: matchedDeck.keyLabel || "",
    color: matchedDeck.color || "blue",
    rating: Number.isFinite(matchedDeck.rating) ? matchedDeck.rating : 0,
    year: Number.isFinite(matchedDeck.year) ? matchedDeck.year : new Date().getUTCFullYear(),
    bitrate: Number.isFinite(matchedDeck.bitrate) ? matchedDeck.bitrate : 320,
    durationSeconds: Math.max(0, Math.round((matchedDeck.trackLengthMs || 0) / 1000)),
    tempo: Number.isFinite(matchedDeck.bpm) ? matchedDeck.bpm : 0,
    artworkId: Number.isFinite(matchedDeck.artworkId) ? matchedDeck.artworkId : 0,
    path: matchedDeck.path || `/USB/${(matchedDeck.title || `Track-${trackId}`).replace(/\s+/g, "-")}.wav`,
  };
}

function buildMetadataItems(track) {
  return [
    { type: ITEM_TYPE.TrackTitle, mainId: track.id, label1: track.title, artworkId: track.artworkId },
    { type: ITEM_TYPE.Artist, mainId: track.id, label1: track.artist, artworkId: 0 },
    { type: ITEM_TYPE.AlbumTitle, mainId: track.id, label1: track.album, artworkId: 0 },
    { type: ITEM_TYPE.Genre, mainId: track.id, label1: track.genre, artworkId: 0 },
    { type: ITEM_TYPE.Duration, mainId: track.durationSeconds, label1: "", artworkId: 0 },
    { type: ITEM_TYPE.Tempo, mainId: Math.round(track.tempo * 100), label1: "", artworkId: 0 },
    { type: colorItemType(track.color), mainId: 0, label1: `${track.color || "blue"}`, artworkId: 0 },
    { type: ITEM_TYPE.Comment, mainId: 0, label1: track.comment, artworkId: 0 },
    { type: ITEM_TYPE.Label, mainId: track.id, label1: track.label, artworkId: 0 },
    { type: ITEM_TYPE.Key, mainId: track.id, label1: track.keyLabel, artworkId: 0 },
    { type: ITEM_TYPE.Rating, mainId: track.rating, label1: "", artworkId: 0 },
    { type: ITEM_TYPE.Year, mainId: 0, label1: `${track.year}`, artworkId: 0 },
    { type: ITEM_TYPE.BitRate, mainId: track.bitrate, label1: "", artworkId: 0 },
  ].filter((item) => item.label1 !== "" || [ITEM_TYPE.Duration, ITEM_TYPE.Tempo, ITEM_TYPE.Rating, ITEM_TYPE.BitRate].includes(item.type) || item.type >= ITEM_TYPE.ColorNone && item.type <= ITEM_TYPE.ColorPurple);
}

function buildTrackInfoItems(track) {
  return [{ type: ITEM_TYPE.Path, mainId: 0, label1: track.path, artworkId: 0 }];
}

function menuItemMessage(transactionId, item) {
  return encodeMessage(MESSAGE_TYPE.MenuItem, transactionId, [
    { kind: "u32", value: item.parentId || 0 },
    { kind: "u32", value: item.mainId || 0 },
    { kind: "u32", value: item.sortId || 0 },
    { kind: "string", value: item.label1 || "" },
    { kind: "u32", value: item.label2Value || 0 },
    { kind: "string", value: item.label2 || "" },
    { kind: "u32", value: item.type || 0 },
    { kind: "u32", value: item.flags || 0 },
    { kind: "u32", value: item.artworkId || 0 },
  ]);
}

function successMessage(transactionId, requestType, itemsAvailable) {
  return encodeMessage(MESSAGE_TYPE.Success, transactionId, [
    { kind: "u32", value: requestType },
    { kind: "u32", value: itemsAvailable },
  ]);
}

function emptyMessage(type, transactionId) {
  return encodeMessage(type, transactionId, []);
}

function binaryResponseMessage(type, transactionId, data) {
  return encodeMessage(type, transactionId, [
    { kind: "u32", value: type },
    { kind: "u32", value: 0 },
    { kind: "u32", value: Buffer.isBuffer(data) ? data.length : 0 },
    { kind: "binary", value: data },
  ]);
}

class RemoteDbServer {
  constructor(options) {
    this.bindAddress = options.bindAddress;
    this.queryPort = options.queryPort || REMOTEDB_QUERY_PORT;
    this.dbPort = options.dbPort || 15000;
    this.getRuntimeState = options.getRuntimeState;
    this.log = options.log || (() => {});
    this.queryServer = null;
    this.dbServer = null;
  }

  async start() {
    this.queryServer = net.createServer((socket) => {
      socket.once("data", () => {
        const response = Buffer.alloc(2);
        response.writeUInt16BE(this.dbPort, 0);
        socket.end(response);
      });
      socket.on("error", () => {});
    });

    this.dbServer = net.createServer((socket) => {
      void this.handleDbConnection(socket).catch((error) => {
        if (!/socket closed/i.test(error.message)) {
          this.log(`remote db client error: ${error.message}`);
        }
        socket.destroy();
      });
    });

    await Promise.all([
      new Promise((resolve, reject) => {
        this.queryServer.once("error", reject);
        this.queryServer.listen(this.queryPort, this.bindAddress, () => {
          this.queryServer.off("error", reject);
          resolve();
        });
      }),
      new Promise((resolve, reject) => {
        this.dbServer.once("error", reject);
        this.dbServer.listen(this.dbPort, this.bindAddress, () => {
          this.dbServer.off("error", reject);
          resolve();
        });
      }),
    ]);

    this.log(`remote db online on ${this.bindAddress}:${this.queryPort} -> ${this.dbPort}`);
  }

  async stop() {
    await Promise.all(
      [this.queryServer, this.dbServer]
        .filter(Boolean)
        .map(
          (server) =>
            new Promise((resolve) => {
              server.close(() => resolve());
            }),
        ),
    );
  }

  async handleDbConnection(socket) {
    const reader = new BufferedSocketReader(socket);
    const preamble = await readField(reader, FIELD_TYPE.UInt32);
    if (preamble.value !== 1) {
      throw new Error(`Unexpected remote db preamble ${preamble.value}.`);
    }
    await write(socket, encodeUInt32(1));

    const context = {
      hostDeviceId: 0,
      currentMenuItems: [],
      currentRequestType: 0,
    };

    while (!socket.destroyed) {
      const message = await readMessage(reader);

      if (message.type === MESSAGE_TYPE.Introduce) {
        context.hostDeviceId = message.args[0]?.value || 0;
        await write(socket, successMessage(message.transactionId, 0, 0));
        continue;
      }

      if (message.type === MESSAGE_TYPE.Disconnect) {
        socket.end();
        return;
      }

      if (
        message.type === MESSAGE_TYPE.GetMetadata ||
        message.type === MESSAGE_TYPE.GetGenericMetadata ||
        message.type === MESSAGE_TYPE.GetTrackInfo
      ) {
        const trackId = message.args[1]?.value || 0;
        const runtimeState = this.getRuntimeState();
        const track = buildTrackRecord(trackId, runtimeState);
        context.currentRequestType = message.type;
        context.currentMenuItems =
          message.type === MESSAGE_TYPE.GetTrackInfo ? buildTrackInfoItems(track) : buildMetadataItems(track);
        await write(socket, successMessage(message.transactionId, message.type, context.currentMenuItems.length));
        continue;
      }

      if (message.type === MESSAGE_TYPE.RenderMenu) {
        const offset = message.args[1]?.value || 0;
        const count = message.args[2]?.value || context.currentMenuItems.length;
        const total = context.currentMenuItems.length;
        const items = context.currentMenuItems.slice(offset, offset + count);
        await write(socket, emptyMessage(MESSAGE_TYPE.MenuHeader, message.transactionId));
        for (const item of items) {
          await write(socket, menuItemMessage(message.transactionId, item));
        }
        await write(socket, emptyMessage(MESSAGE_TYPE.MenuFooter, message.transactionId));
        continue;
      }

      if (message.type === MESSAGE_TYPE.GetBeatGrid) {
        await write(socket, binaryResponseMessage(MESSAGE_TYPE.BeatGrid, message.transactionId, Buffer.alloc(0x14)));
        continue;
      }

      if (message.type === MESSAGE_TYPE.GetArtwork) {
        await write(socket, binaryResponseMessage(MESSAGE_TYPE.Artwork, message.transactionId, Buffer.alloc(0)));
        continue;
      }

      if (message.type === MESSAGE_TYPE.GetWaveformPreview) {
        await write(socket, binaryResponseMessage(MESSAGE_TYPE.WaveformPreview, message.transactionId, Buffer.alloc(800)));
        continue;
      }

      if (message.type === MESSAGE_TYPE.GetWaveformDetailed) {
        await write(socket, binaryResponseMessage(MESSAGE_TYPE.WaveformDetailed, message.transactionId, Buffer.alloc(0)));
        continue;
      }

      if (message.type === MESSAGE_TYPE.GetWaveformHD) {
        await write(socket, binaryResponseMessage(MESSAGE_TYPE.WaveformHD, message.transactionId, Buffer.alloc(0x34)));
        continue;
      }

      if (message.type === MESSAGE_TYPE.GetCueAndLoops) {
        await write(socket, binaryResponseMessage(MESSAGE_TYPE.CueAndLoop, message.transactionId, Buffer.alloc(0)));
        continue;
      }

      if (message.type === MESSAGE_TYPE.GetAdvCueAndLoops) {
        await write(socket, binaryResponseMessage(MESSAGE_TYPE.AdvCueAndLoops, message.transactionId, Buffer.alloc(0)));
        continue;
      }

      await write(socket, emptyMessage(MESSAGE_TYPE.Error, message.transactionId));
    }
  }
}

module.exports = {
  RemoteDbServer,
  REMOTEDB_QUERY_PORT,
};
