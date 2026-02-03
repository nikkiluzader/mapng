const textDecoder = new TextDecoder('utf-8')
const textEncoder = new TextEncoder()

function readU8(dv, o) {
  return dv.getUint8(o)
}

function readU16le(dv, o) {
  return dv.getUint16(o, true)
}

function readU32le(dv, o) {
  return dv.getUint32(o, true)
}

function readString(dv, buffer, o) {
  let len = readU8(dv, o)
  o += 1
  if (len === 255) {
    len = readU16le(dv, o)
    o += 2
  }

  const bytes = new Uint8Array(buffer, o, len)
  o += len
  return { value: textDecoder.decode(bytes), offset: o }
}

export function parseTer(buffer) {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error('parseTer: expected ArrayBuffer')
  }

  const dv = new DataView(buffer)
  let o = 0

  const version = readU8(dv, o)
  o += 1
  if (version !== 9) {
    throw new Error(`parseTer: unsupported version ${version} (expected 9)`)
  }

  const size = readU32le(dv, o)
  o += 4

  const sampleCount = size * size
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) {
    throw new Error(`parseTer: invalid size ${size}`)
  }

  // Heightmap starts at byte offset 5 (unaligned for Uint16Array), so slice/copy.
  const hBytesLen = sampleCount * 2
  const heightMap = new Uint16Array(buffer.slice(o, o + hBytesLen))
  o += hBytesLen

  const layerMap = new Uint8Array(buffer.slice(o, o + sampleCount))
  o += sampleCount

  const materialCount = readU32le(dv, o)
  o += 4

  const materials = []
  for (let i = 0; i < materialCount; i++) {
    const r = readString(dv, buffer, o)
    materials.push(r.value)
    o = r.offset
  }

  return {
    version,
    size,
    heightMap,
    layerMap,
    materials
  }
}

function stringEncodedSize(str) {
  const bytes = textEncoder.encode(String(str))
  const len = bytes.length
  const prefix = len < 255 ? 1 : 3
  return { bytes, len, prefix, total: prefix + len }
}

function writeU8(dv, o, v) {
  dv.setUint8(o, v & 0xff)
  return o + 1
}

function writeU16le(dv, o, v) {
  dv.setUint16(o, v & 0xffff, true)
  return o + 2
}

function writeU32le(dv, o, v) {
  dv.setUint32(o, v >>> 0, true)
  return o + 4
}

function writeString(dv, u8, o, str) {
  const { bytes, len } = stringEncodedSize(str)
  if (len < 255) {
    o = writeU8(dv, o, len)
  } else {
    o = writeU8(dv, o, 255)
    o = writeU16le(dv, o, len)
  }
  u8.set(bytes, o)
  return o + len
}

export function encodeTer(ter) {
  const version = Number(ter?.version)
  if (version !== 9) {
    throw new Error(`encodeTer: unsupported version ${version} (expected 9)`)
  }
  const size = Number(ter?.size)
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`encodeTer: invalid size ${ter?.size}`)
  }

  const sampleCount = size * size
  const heightMap = ter?.heightMap
  const layerMap = ter?.layerMap
  if (!(heightMap instanceof Uint16Array) || heightMap.length !== sampleCount) {
    throw new Error('encodeTer: heightMap must be Uint16Array(size*size)')
  }
  if (!(layerMap instanceof Uint8Array) || layerMap.length !== sampleCount) {
    throw new Error('encodeTer: layerMap must be Uint8Array(size*size)')
  }

  const materials = Array.isArray(ter?.materials) ? ter.materials : []
  const matInfos = materials.map((m) => stringEncodedSize(m))
  const matsBytesLen = matInfos.reduce((acc, it) => acc + it.total, 0)

  // Header (1+4) + Heightmap (2*N) + LayerMap (1*N) + MatCount (4) + Materials
  const totalLen = 1 + 4 + sampleCount * 2 + sampleCount + 4 + matsBytesLen
  const buffer = new ArrayBuffer(totalLen)
  const dv = new DataView(buffer)
  const u8 = new Uint8Array(buffer)
  let o = 0

  o = writeU8(dv, o, 9)
  o = writeU32le(dv, o, size)

  // Heightmap as little-endian u16
  for (let i = 0; i < heightMap.length; i++) {
    o = writeU16le(dv, o, heightMap[i])
  }

  u8.set(layerMap, o)
  o += layerMap.length

  o = writeU32le(dv, o, materials.length)
  for (let i = 0; i < materials.length; i++) {
    o = writeString(dv, u8, o, materials[i])
  }

  return buffer
}

