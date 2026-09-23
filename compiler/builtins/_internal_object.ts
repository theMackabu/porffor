import type {} from './porffor.d.ts';

// __memory layout__
// per object (16):
//  size (u16, 2)
//  capacity (u16, 2)
//  root flags (u8, 1):
//   inextensible - 0b0001
//  prototype type (u8, 1)
//  padding (u16, 2)
//  prototype (u32, 4)
//  entries pointer (u32, 4)
// per entry (16):
//  key - value (u32, 4)
//  key - hash, top 16 bits (u16, 2)
//  flags (u8, 1):
//   accessor - 0b0001
//   configurable - 0b0010
//   enumerable - 0b0100
//   writable - 0b1000
//   key kind - 0b110000: 0b00 bytestring, 0b01 string, 0b10 symbol
//  value - type (u8, 1)
//  value (f64, 8) or accessor pair (u32, 4 each)
// string keys are stored canonical (render.js key table): content that has a static string is always
// stored as that one pointer, so looking up by a static key compares pointers. only lookups by other
// strings compare contents, using the hash to skip entries

// hash key for hashmap
export const __Porffor_object_hashMix = (hash: i32, word: i32): i32 => {
  hash += word * 3266489917;
  hash = (hash << 17) | (hash >>> 15);
  return hash * 668265263;
};

export const __Porffor_object_hashAvalanche = (hash: i32): i32 => {
  hash = (hash ^ (hash >>> 15)) * 2246822519;
  hash = (hash ^ (hash >>> 13)) * 3266489917;
  return hash ^ (hash >>> 16);
};

export const __Porffor_object_hash = (key: any): i32 => {
  if (Porffor.comptime.flag`hasType.symbol`) {
    if (Porffor.type(key) == Porffor.TYPES.symbol) {
      // symbol, hash is unused so just return 0
      return 0;
    }
  }

  // bytestring or string, xxh32-based hash
  let p: i32 = Porffor.IR.ptr(key);
  const len: i32 = Porffor.IR.loadI32(key, 0);
  let hash: i32 = 374761393;

  if (Porffor.type(key) == Porffor.TYPES.string) {
    const stringEnd: i32 = p + len * 2;
    let word: i32 = 0;
    let shift: i32 = 0;

    while (p < stringEnd) {
      const chr: i32 = Porffor.IR.loadU16(p, 4);
      p += 2;

      word |= (chr & 0xFF) << shift;
      shift += 8;
      if (shift == 32) {
        hash = __Porffor_object_hashMix(hash, word);
        word = 0;
        shift = 0;
      }

      const high: i32 = chr >> 8;
      if (high != 0) {
        word |= high << shift;
        shift += 8;
        if (shift == 32) {
          hash = __Porffor_object_hashMix(hash, word);
          word = 0;
          shift = 0;
        }
      }
    }

    if (shift != 0) hash = __Porffor_object_hashMix(hash, word);
    return __Porffor_object_hashAvalanche(hash);
  }

  const end: i32 = p + len;
  while (p + 4 <= end) {
    hash = __Porffor_object_hashMix(hash, Porffor.IR.loadI32(p, 4));
    p += 4;
  }

  if (p != end) {
    const mask: i32 = (1 << ((end - p) * 8)) - 1;
    hash = __Porffor_object_hashMix(hash, Porffor.IR.loadI32(p, 4) & mask);
  }

  return __Porffor_object_hashAvalanche(hash);
};

export const __Porffor_object_writeKey = (ptr: i32, key: any, hash: i32): void => {
  let kind: i32 = 0;
  if (Porffor.type(key) == Porffor.TYPES.string) kind = 0b010000;
    else if (Porffor.type(key) == Porffor.TYPES.symbol) kind = 0b100000;

  // in C: bitwise ops here lower to u32, and storing a value >= 2^31 through i32 saturates
  Porffor.c`{
    u32 k = (u32)key.val, kd = (u32)kind;
    if (kd != 0x20u && k >= PORF_STATIC_CANON_END) {
      const u64 c = porf_key_canon(k, kd == 0x10u, hash);
      if (c != ~0ull) { k = (u32)c; kd = (u32)(c >> 32) << 4; }
    }
    *(u32*)(MEM + (u32)ptr) = k;
    *(u32*)(MEM + (u32)ptr + 4u) = ((u32)hash >> 16) | (kd << 16);
  }`;
};

export const __Porffor_object_readKey = (ptr: i32): any => {
  const kind: i32 = Porffor.IR.loadU8(ptr, 6) & 0b110000;
  const key: i32 = Porffor.IR.loadI32(ptr, 0);
  if (kind == 0) return Porffor.as(key, Porffor.TYPES.bytestring);
  if (kind == 0b010000) return Porffor.as(key, Porffor.TYPES.string);
  return Porffor.as(key, Porffor.TYPES.symbol);
};

export const __Porffor_object_isSymbolKey = (ptr: i32): boolean => {
  return (Porffor.IR.loadU8(ptr, 6) & 0b110000) == 0b100000;
};

// target must be a string or bytestring whose hash matched
export const __Porffor_object_keyMatches = (ptr: i32, target: any): boolean => {
  if ((Porffor.IR.loadU8(ptr, 6) & 0b110000) == 0b100000) return false;
  if (Porffor.IR.loadI32(ptr, 0) == Porffor.IR.ptr(target)) return true;
  return Porffor.strcmp(__Porffor_object_readKey(ptr), target);
};

export const __Porffor_object_writeFlags = (ptr: i32, flags: i32): void => {
  Porffor.c`*(u8*)(MEM + (u32)ptr + 6u) = (u8)((*(u8*)(MEM + (u32)ptr + 6u) & 0xF0u) | ((u32)flags & 0x0Fu));`;
};

export const __Porffor_object_writeValue = (ptr: i32, value: any, flags: i32): void => {
  Porffor.c`porf_store_un_f64(MEM + (u32)ptr + 8u, value.val);
  *(u8*)(MEM + (u32)ptr + 7u) = (u8)value.type;
  *(u8*)(MEM + (u32)ptr + 6u) = (u8)((*(u8*)(MEM + (u32)ptr + 6u) & 0xF0u) | ((u32)flags & 0x0Fu));`;
};

export const __Porffor_object_new = (capacity: i32 = 4): object => {
  const obj: object = Porffor.malloc(16 + capacity * 16);
  Porffor.IR.storeU16(obj, 0, 0);
  Porffor.IR.storeU16(obj, 2, capacity);
  Porffor.IR.storeU8(obj, 4, 0);
  Porffor.IR.storeU8(obj, 5, 0);
  Porffor.IR.storeI32(obj, 8, 0);
  Porffor.IR.storeI32(obj, 12, Porffor.IR.ptr(obj) + 16);
  return obj;
};

export const __Porffor_object_newShared = (capacity: i32 = 4): object => {
  const obj: object = __Porffor_mallocShared(16 + capacity * 16);
  Porffor.IR.storeU16(obj, 0, 0);
  Porffor.IR.storeU16(obj, 2, capacity);
  Porffor.IR.storeU8(obj, 4, 0);
  Porffor.IR.storeU8(obj, 5, 0);
  Porffor.IR.storeI32(obj, 8, 0);
  Porffor.IR.storeI32(obj, 12, Porffor.IR.ptr(obj) + 16);
  return obj;
};

export const __Porffor_object_entriesPtr = (obj: any): i32 => {
  return Porffor.IR.loadI32(obj, 12);
};

export const __Porffor_object_ensureCapacity = (obj: any, needed: i32): i32 => {
  let capacity: i32 = Porffor.IR.loadU16(obj, 2);
  const entriesPtr: i32 = Porffor.IR.loadI32(obj, 12);
  if (needed <= capacity) return entriesPtr;

  if (capacity == 0) capacity = 1;
  while (capacity < needed) capacity *= 2;

  const newEntriesPtr: i32 = Porffor.malloc(capacity * 16);
  const size: i32 = Porffor.IR.loadU16(obj, 0);
  if (size > 0) {
    Porffor.IR.copy(newEntriesPtr, entriesPtr, size * 16);
  }

  Porffor.IR.storeU16(obj, 2, capacity);
  Porffor.IR.storeI32(obj, 12, newEntriesPtr);
  Porffor.IR.gcBarrier(obj, Porffor.TYPES.object);
  return newEntriesPtr;
};

// bumped when an object some get IC cached a prototype hit through (root flags 0b0010) changes shape
let protoEpoch: i32 = 1;

export const __Porffor_object_protoChanged = (obj: any): void => {
  if (Porffor.IR.loadU8(obj, 4) & 0b0010) protoEpoch++;
};

export const __Porffor_object_appendEntry = (obj: any, key: any, hash: i32): i32 => {
  __Porffor_object_protoChanged(obj);
  const size: i32 = Porffor.IR.loadU16(obj, 0);
  const entriesPtr: i32 = __Porffor_object_ensureCapacity(obj, size + 1);
  Porffor.IR.storeU16(obj, 0, size + 1);
  const entryPtr: i32 = entriesPtr + size * 16;
  __Porffor_object_writeKey(entryPtr, key, hash);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, key);
  return entryPtr;
};

export const __Porffor_object_fastAdd = (obj: any, key: any, value: any, flags: i32): void => {
  const entryPtr: i32 = __Porffor_object_appendEntry(obj, key, __Porffor_object_hash(key));

  __Porffor_object_writeValue(entryPtr, value, flags);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, value);
};

export const __Porffor_object_readValue = (entryPtr: i32): any => {
  return Porffor.as(Porffor.IR.loadUnF64(entryPtr, 8), Porffor.IR.loadU8(entryPtr, 7));
};

// store underlying (real) objects for hidden types
let underlyingStore: i32 = 0;
let underlyingBuckets: i32 = 0;
let underlyingBucketsCap: i32 = 0;

export const __Porffor_underlyingInsertEntry = (base: i32, index: i32): void => {
  let hash: i32 = Porffor.IR.ptr(Porffor.IR.loadJv(base, 0));
  hash = hash >>> 3;
  hash ^= hash >>> 16;
  hash *= 0x7feb352d;
  hash ^= hash >>> 15;
  hash ^= Porffor.IR.loadU8(base, 12);

  let slot: i32 = hash & (underlyingBucketsCap - 1);
  while (true) {
    if (Porffor.IR.loadI32(underlyingBuckets + slot * 4, 0) == 0) {
      Porffor.IR.storeI32(underlyingBuckets + slot * 4, 0, index + 1);
      return;
    }

    slot = (slot + 1) & (underlyingBucketsCap - 1);
  }
};

export const __Porffor_underlyingRebuild = (): void => {
  let len: i32 = Porffor.IR.loadI32(underlyingStore, 0);
  let cap: i32 = 16;
  while (cap * 3 < (len + 1) * 4) cap *= 2;

  underlyingBuckets = Porffor.malloc(cap * 4);
  Porffor.IR.fill(underlyingBuckets, 0, cap * 4);
  underlyingBucketsCap = cap;

  len = Porffor.IR.loadI32(underlyingStore, 0);

  for (let i: i32 = 0; i < len; i++) {
    __Porffor_underlyingInsertEntry(underlyingStore + 8 + i * 16, i);
  }
};

export const __Porffor_object_underlying = (_obj: any): any => {
  const objType: i32 = Porffor.type(_obj);
  if (objType == Porffor.TYPES.object) return _obj;

  if (objType > 0x05) {
    if (underlyingStore == 0) {
      underlyingStore = Porffor.malloc();
      Porffor.IR.storeI32(underlyingStore, 0, 0);
      Porffor.IR.storeI32(underlyingStore, 4, 1023);
    }

    let underlyingLength: i32 = Porffor.IR.loadI32(underlyingStore, 0);
    if (Porffor.fastAnd(underlyingBuckets == 0, underlyingLength > 0)) __Porffor_underlyingRebuild();

    if (underlyingBuckets != 0) {
      let lookupHash: i32 = Porffor.IR.ptr(_obj);
      lookupHash = lookupHash >>> 3;
      lookupHash ^= lookupHash >>> 16;
      lookupHash *= 0x7feb352d;
      lookupHash ^= lookupHash >>> 15;
      lookupHash ^= objType;

      let slot: i32 = lookupHash & (underlyingBucketsCap - 1);
      while (true) {
        const entry: i32 = Porffor.IR.loadI32(underlyingBuckets + slot * 4, 0);
        if (entry == 0) break;

        const base: i32 = underlyingStore + 8 + (entry - 1) * 16;
        if (Porffor.fastAnd(
          Porffor.IR.ptr(Porffor.IR.loadJv(base, 0)) == Porffor.IR.ptr(_obj),
          Porffor.IR.loadU8(base, 12) == objType
        ))
          return Porffor.IR.loadI32(base, 8) as object;

        slot = (slot + 1) & (underlyingBucketsCap - 1);
      }
    }

    // grow the weak store before allocating the underlying object: this malloc
    // could otherwise collect the not-yet-registered object
    const capacity: i32 = Porffor.IR.loadI32(underlyingStore, 4);
    if (underlyingLength >= capacity) {
      const newCapacity: i32 = capacity * 2;
      const newStore: i32 = Porffor.malloc(8 + newCapacity * 16);

      underlyingLength = Porffor.IR.loadI32(underlyingStore, 0);
      const copyBytes: i32 = 8 + underlyingLength * 16;
      for (let i: i32 = 0; i < copyBytes; i += 4) {
        Porffor.IR.storeI32(newStore + i, 0, Porffor.IR.loadI32(underlyingStore + i, 0));
      }

      underlyingStore = newStore;
      Porffor.IR.storeI32(underlyingStore, 4, newCapacity);
    }

    let obj: any = _obj;

    let underlyingCapacity: i32 = 4;
    if (Porffor.fastOr(
      objType == Porffor.TYPES.string,
      objType == Porffor.TYPES.stringobject
    )) {
      underlyingCapacity = (obj as string).length + 1;
      if (underlyingCapacity > 4097) underlyingCapacity = 4;
    } else if (objType == Porffor.TYPES.bytestring) {
      underlyingCapacity = (obj as bytestring).length + 1;
      if (underlyingCapacity > 4097) underlyingCapacity = 4;
    }

    const underlying: object = __Porffor_object_new(underlyingCapacity);

    // publish before initialization can allocate, so the GC's underlying-store scanner sees both
    underlyingLength = Porffor.IR.loadI32(underlyingStore, 0);
    Porffor.IR.storeI32(underlyingStore, 0, underlyingLength + 1);
    const base: i32 = underlyingStore + 8 + underlyingLength * 16;
    Porffor.IR.storeJv(base, 0, _obj);
    Porffor.IR.storeI32(base, 8, underlying);
    Porffor.IR.storeU8(base, 12, objType);

    if (objType == Porffor.TYPES.function) {
      __Porffor_object_fastAdd(underlying, 'length', __Porffor_funcLut_length(obj), 0b0010);
      __Porffor_object_fastAdd(underlying, 'name', __Porffor_funcLut_name(obj), 0b0010);

      if (ecma262.IsConstructor(_obj)) { // constructor
        const builtinProto: any = __Porffor_object_builtinPrototype(_obj);
        if (builtinProto !== undefined) {
          __Porffor_object_fastAdd(underlying, 'prototype', builtinProto, 0b0000);
        } else {
          const proto: object = __Porffor_object_new(1);
          __Porffor_object_fastAdd(underlying, 'prototype', proto, 0b1000);
          __Porffor_object_fastAdd(proto, 'constructor', _obj, 0b1010);
        }
      }
    }

    if (objType == Porffor.TYPES.array) {
      // index props are not materialized (the live array is the source of truth), only expando props and length live here
      const len: i32 = Porffor.IR.loadI32(obj, 0);
      __Porffor_object_fastAdd(underlying, 'length', len, 0b1000);
    }

    if (Porffor.fastOr(
      objType == Porffor.TYPES.string,
      objType == Porffor.TYPES.stringobject
    )) {
      const len: i32 = (obj as string).length;
      __Porffor_object_fastAdd(underlying, 'length', len, 0b0000);

      // size/capacity are u16: skip per-index props for huge strings
      const matLen: i32 = len > 4096 ? 0 : len;
      for (let i: i32 = 0; i < matLen; i++) {
        __Porffor_object_fastAdd(underlying, Porffor.callThis(__Number_prototype_toString, i), (obj as string)[i], 0b0100);
      }

      if (objType == Porffor.TYPES.string) {
        Porffor.IR.storeU8(underlying, 4, 0b0001);
      }
    }

    if (objType == Porffor.TYPES.bytestring) {
      const len: i32 = (obj as bytestring).length;
      __Porffor_object_fastAdd(underlying, 'length', len, 0b0000);

      const matLen: i32 = len > 4096 ? 0 : len;
      for (let i: i32 = 0; i < matLen; i++) {
        __Porffor_object_fastAdd(underlying, Porffor.callThis(__Number_prototype_toString, i), (obj as bytestring)[i], 0b0100);
      }

      Porffor.IR.storeU8(underlying, 4, 0b0001);
    }

    if (Porffor.fastOr(underlyingBuckets == 0, (underlyingLength + 2) * 4 > underlyingBucketsCap * 3)) {
      __Porffor_underlyingRebuild();
    } else {
      __Porffor_underlyingInsertEntry(base, underlyingLength);
    }

    return underlying;
  }

  return _obj;
};

export const __Porffor_object_isObject = (arg: any): boolean => {
  const t: i32 = Porffor.type(arg);
  return Porffor.fastAnd(
    Porffor.fastOr(arg != 0, t != Porffor.TYPES.object), // null
    t > 0x05,
    t != Porffor.TYPES.string,
    t != Porffor.TYPES.bytestring
  );
};

export const __Porffor_object_isObjectOrNull = (arg: any): boolean => {
  const t: i32 = Porffor.type(arg);
  return Porffor.fastAnd(
    t > 0x05,
    t != Porffor.TYPES.string,
    t != Porffor.TYPES.bytestring
  );
};

export const __Porffor_object_isObjectOrSymbol = (arg: any): boolean => {
  const t: i32 = Porffor.type(arg);
  return Porffor.fastAnd(
    Porffor.fastOr(arg != 0, t != Porffor.TYPES.object), // null
    t > 0x04,
    t != Porffor.TYPES.string,
    t != Porffor.TYPES.bytestring
  );
};


export const __Porffor_object_preventExtensions = (obj: any): void => {
  if (Porffor.type(obj) != Porffor.TYPES.object) {
    obj = __Porffor_object_underlying(obj);
    if (Porffor.type(obj) != Porffor.TYPES.object) return;
  }

  Porffor.IR.storeU8(obj, 4, Porffor.IR.loadU8(obj, 4) | 0b0001);
};

export const __Porffor_object_isInextensible = (obj: any): boolean => {
  if (Porffor.type(obj) != Porffor.TYPES.object) {
    obj = __Porffor_object_underlying(obj);
    if (Porffor.type(obj) != Porffor.TYPES.object) return false;
  }

  return (Porffor.IR.loadU8(obj, 4) & 0b0001) != 0;
};

export const __Porffor_object_setPrototype = (obj: any, proto: any): void => {
  if (Porffor.type(obj) != Porffor.TYPES.object) {
    obj = __Porffor_object_underlying(obj);
    if (Porffor.type(obj) != Porffor.TYPES.object) return;
  }

  if (__Porffor_object_isObjectOrNull(proto)) {
    __Porffor_object_protoChanged(obj);
    Porffor.IR.storeI32(obj, 8, proto);
    Porffor.IR.storeU8(obj, 5, Porffor.type(proto));
    Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, proto);
  }
};

export const __Porffor_object_getPrototype = (obj: any): any => {
  if (Porffor.type(obj) != Porffor.TYPES.object) {
    obj = __Porffor_object_underlying(obj);
    if (Porffor.type(obj) != Porffor.TYPES.object) {
      return undefined;
    }
  }

  return Porffor.as(Porffor.IR.loadI32(obj, 8), Porffor.IR.loadU8(obj, 5));
};

export const __Porffor_object_getPrototypeWithHidden = (obj: any, trueType: i32): any => {
  const objectProto: any = __Porffor_object_getPrototype(obj);
  if (Porffor.type(objectProto) != Porffor.TYPES.undefined) return objectProto;

  return __Porffor_object_getHiddenPrototype(trueType);
};


export const __Porffor_object_overrideAllFlags = (obj: any, overrideOr: i32, overrideAnd: i32): void => {
  if (Porffor.type(obj) != Porffor.TYPES.object) {
    obj = __Porffor_object_underlying(obj);
    if (Porffor.type(obj) != Porffor.TYPES.object) return;
  }

  let ptr: i32 = __Porffor_object_entriesPtr(obj);
  const size: i32 = Porffor.IR.loadU16(obj, 0);
  const endPtr: i32 = ptr + size * 16;

  for (; ptr < endPtr; ptr += 16) {
    let flags: i32 = (Porffor.IR.loadU8(ptr, 6) & 0b1111);
    flags = (flags | overrideOr) & overrideAnd;
    __Porffor_object_writeFlags(ptr, flags);
  }
};

export const __Porffor_object_checkAllFlags = (obj: any, dataAnd: i32, accessorAnd: i32, dataExpected: i32, accessorExpected: i32): boolean => {
  if (Porffor.type(obj) != Porffor.TYPES.object) {
    obj = __Porffor_object_underlying(obj);
    if (Porffor.type(obj) != Porffor.TYPES.object) return false;
  }

  let ptr: i32 = __Porffor_object_entriesPtr(obj);
  const size: i32 = Porffor.IR.loadU16(obj, 0);
  const endPtr: i32 = ptr + size * 16;

  for (; ptr < endPtr; ptr += 16) {
    const flags: i32 = (Porffor.IR.loadU8(ptr, 6) & 0b1111);
    if (flags & 0b0001) {
      // accessor
      if ((flags & accessorAnd) != accessorExpected) return false;
    } else {
      // data
      if ((flags & dataAnd) != dataExpected) return false;
    }

  }

  return true;
};

export const __Porffor_object_accessorGet = (entryPtr: i32): Function|undefined => {
  const out: Function = Porffor.IR.loadI32(entryPtr, 8);

  if (Porffor.IR.ptr(out) == 0) return undefined;
  return out;
};

export const __Porffor_object_accessorSet = (entryPtr: i32): Function|undefined => {
  const out: Function = Porffor.IR.loadI32(entryPtr, 12);

  if (Porffor.IR.ptr(out) == 0) return undefined;
  return out;
};

export const __Porffor_object_writeAccessor = (entryPtr: i32, get: i32, set: i32): void => {
  Porffor.IR.storeI32(entryPtr, 8, get);
  Porffor.IR.storeI32(entryPtr, 12, set);
};

export const __Porffor_object_lookup = (obj: any, target: any, targetHash: i32): i32 => {
  if (Porffor.IR.ptr(obj) == 0) return 0;

  if (Porffor.comptime.flag`hasType.symbol`) {
    if (Porffor.type(target) == Porffor.TYPES.symbol) {
      let ptr: i32 = __Porffor_object_entriesPtr(obj);
      const endPtr: i32 = ptr + Porffor.IR.loadU16(obj, 0) * 16;
      for (; ptr < endPtr; ptr += 16) {
        if (Porffor.fastAnd(__Porffor_object_isSymbolKey(ptr), Porffor.IR.loadI32(ptr, 0) == Porffor.IR.ptr(target))) return ptr;
      }

      return 0;
    }
  }

  // a canonical key is the only pointer its content is stored under
  Porffor.c`if ((u32)target.val < PORF_STATIC_CANON_END) {
    u32 p = *(u32*)(MEM + (u32)obj.val + 12u);
    const u32 end = p + ((u32)*(u16*)(MEM + (u32)obj.val) << 4);
    for (; p < end; p += 16u) if (*(u32*)(MEM + p) == (u32)target.val) return (i32)p;
    return 0;
  }`;
  return __Porffor_object_lookupDynamic(obj, target, targetHash);
};

// key is a static literal (every _withHash caller: codegen only passes a hash for literal names), so
// canonical: its pointer is the only match
export const __Porffor_object_lookupLit = (obj: any, key: any): i32 => {
  Porffor.c`{
    if ((u32)obj.val == 0u) return 0;
    u32 p = *(u32*)(MEM + (u32)obj.val + 12u);
    const u32 end = p + ((u32)*(u16*)(MEM + (u32)obj.val) << 4);
    for (; p < end; p += 16u) if (*(u32*)(MEM + p) == (u32)key.val) return (i32)p;
    return 0;
  }`;
  return 0;
};

// target is a non canonical string: use its canonical form, else compare contents
export const __Porffor_object_lookupDynamic = (obj: any, target: any, targetHash: i32): i32 => {
  let wide: i32 = 0;
  if (Porffor.type(target) == Porffor.TYPES.string) wide = 1;
  Porffor.c`{
    const u64 c = porf_key_canon((u32)target.val, wide, targetHash);
    if (c != ~0ull) {
      u32 p = *(u32*)(MEM + (u32)obj.val + 12u);
      const u32 end = p + ((u32)*(u16*)(MEM + (u32)obj.val) << 4);
      for (; p < end; p += 16u) if (*(u32*)(MEM + p) == (u32)c) return (i32)p;
      return 0;
    }
  }`;

  let ptr: i32 = __Porffor_object_entriesPtr(obj);
  const endPtr: i32 = ptr + Porffor.IR.loadU16(obj, 0) * 16;
  for (; ptr < endPtr; ptr += 16) {
    if (Porffor.IR.loadU16(ptr, 4) == ((targetHash >>> 16) & 0xffff)) if (__Porffor_object_keyMatches(ptr, target)) return ptr;
  }

  return 0;
};

export const __Porffor_array_propertyKeyIndex = (key: any): i32 => {
  const keyType: i32 = Porffor.type(key);
  if (Porffor.fastAnd(keyType != Porffor.TYPES.string, keyType != Porffor.TYPES.bytestring)) return -1;

  const len: i32 = key.length;
  if (len == 0) return -1;

  let digit: i32 = key.charCodeAt(0) - 48;
  if (Porffor.fastOr(digit < 0, digit > 9)) return -1;
  if (Porffor.fastAnd(len > 1, digit == 0)) return -1;

  let out: i32 = digit;
  for (let i: i32 = 1; i < len; i++) {
    digit = key.charCodeAt(i) - 48;
    if (Porffor.fastOr(digit < 0, digit > 9)) return -1;
    if (Porffor.fastOr(out > 214748364, Porffor.fastAnd(out == 214748364, digit > 6))) return -1;

    out = out * 10 + digit;
  }

  return out;
};

export const __Porffor_object_get = (_obj: any, key: any): any => {
  let obj: any = _obj;
  const trueType: i32 = Porffor.type(obj);
  if (trueType == Porffor.TYPES.object) {
    if (Porffor.IR.ptr(obj) == 0) throw new TypeError('Cannot get property of null');
  } else {
    if (trueType == Porffor.TYPES.undefined) throw new TypeError('Cannot get property of null');
    obj = __Porffor_object_underlying(obj);
  }

  key = ecma262.ToPropertyKey(key);
  if (trueType == Porffor.TYPES.array) {
    const index: i32 = __Porffor_array_propertyKeyIndex(key);
    if (index != -1) {
      if (__Porffor_array_has(_obj as any[], index)) return (_obj as any[])[index];
    }
  }

  const hash: i32 = __Porffor_object_hash(key);
  let entryPtr: i32 = 0;
  if (Porffor.type(obj) == Porffor.TYPES.object) entryPtr = __Porffor_object_lookup(obj, key, hash);
  if (entryPtr == 0) {
    // check prototype chain
    if (trueType == Porffor.TYPES.object) {
      obj = __Porffor_object_getPrototype(obj);
      // if undefined, prototype is object.prototype
      if (Porffor.type(obj) == Porffor.TYPES.undefined) obj = __Object_prototype;
    } else obj = __Porffor_object_getPrototypeWithHidden(obj, trueType);

    // todo/opt: put this behind comptime flag if only __proto__ is used
    if (hash == 212292208) if (Porffor.strcmp(key, '__proto__')) {
      // get prototype
      return obj;
    }

    let proto: any = obj;
    if (Porffor.type(obj) != Porffor.TYPES.object) obj = __Porffor_object_underlying(obj);
    if (obj == null) return undefined;
    while (true) {
      if ((entryPtr = __Porffor_object_lookup(obj, key, hash)) != 0) break;

      // inline get prototype
      obj = __Porffor_object_getPrototype(obj);
      if (Porffor.type(obj) == Porffor.TYPES.undefined) {
        obj = __Porffor_object_getHiddenPrototype(Porffor.type(proto));
        if (Porffor.IR.ptr(obj) == Porffor.IR.ptr(proto)) obj = __Object_prototype;
      }
      if (Porffor.IR.ptr(obj) == Porffor.IR.ptr(proto)) break;

      proto = obj;
      if (Porffor.type(obj) != Porffor.TYPES.object) obj = __Porffor_object_underlying(obj);
      if (obj == null) break;
    }

    if (entryPtr == 0) return undefined;
  }

  const tail: i32 = Porffor.IR.loadU8(entryPtr, 6); // flags, plus key kind bits above
  if (tail & 0b0001) {
    // accessor descriptor
    const get: Function = __Porffor_object_accessorGet(entryPtr);

    if (Porffor.IR.ptr(get) == 0) return undefined;
    return Porffor.callThis(get, _obj);
  }

  return __Porffor_object_readValue(entryPtr);
};

// per-call-site slot cache stores byte offsets into object entries
// IC_EMPTY is i32 max so unset and stale slots fail the bounds/hash checks
export const __Porffor_object_get_ic = (_obj: any, key: any, hash: i32, slot: i32): any => {
  if (Porffor.type(_obj) == Porffor.TYPES.object) {
    if (Porffor.IR.ptr(_obj) != 0) {
      const off: i32 = Porffor.IR.loadI32(slot, 0);
      if (off < Porffor.IR.loadU16(_obj, 0) * 16) {
        const entryPtr: i32 = Porffor.IR.loadI32(_obj, 12) + off;
        // the key is a static literal, so canonical: same pointer is the only match. any call here
        // would cost this leaf function a register save per hit
        if (Porffor.IR.loadI32(entryPtr, 0) == Porffor.IR.ptr(key)) {
          if ((Porffor.IR.loadU8(entryPtr, 6) & 0b0001) == 0) return __Porffor_object_readValue(entryPtr);
        }
      }

      // prototype hit: same receiver prototype, no own property shadowing it, and no shape change on the
      // chain since (protoEpoch). slot: 4 receiver prototype, 20 its type, 8 holder, 12 entry offset, 16 epoch
      const holder: i32 = Porffor.IR.loadI32(slot, 8);
      if (holder != 0) if (Porffor.IR.loadI32(slot, 16) == protoEpoch) if (Porffor.fastAnd(
        Porffor.IR.loadI32(_obj, 8) == Porffor.IR.loadI32(slot, 4),
        Porffor.IR.loadU8(_obj, 5) == Porffor.IR.loadU8(slot, 20)
      )) {
        let p: i32 = Porffor.IR.loadI32(_obj, 12);
        const end: i32 = p + Porffor.IR.loadU16(_obj, 0) * 16;
        while (p < end) {
          if (Porffor.IR.loadI32(p, 0) == Porffor.IR.ptr(key)) break;
          p += 16;
        }

        if (p >= end) {
          const hoff: i32 = Porffor.IR.loadI32(slot, 12);
          if (hoff < Porffor.IR.loadU16(holder, 0) * 16) {
            const e: i32 = Porffor.IR.loadI32(holder, 12) + hoff;
            if (Porffor.IR.loadI32(e, 0) == Porffor.IR.ptr(key)) {
              if ((Porffor.IR.loadU8(e, 6) & 0b0001) == 0) return __Porffor_object_readValue(e);
            }
          }
        }
      }
    }
  }

  return __Porffor_object_get_icMiss(_obj, key, hash, slot);
};

export const __Porffor_object_get_icMiss = (_obj: any, key: any, hash: i32, slot: i32): any => {
  if (Porffor.type(_obj) == Porffor.TYPES.object) {
    if (Porffor.IR.ptr(_obj) != 0) {
      const entriesPtr: i32 = Porffor.IR.loadI32(_obj, 12);
      let ptr: i32 = entriesPtr;
      const endPtr: i32 = ptr + Porffor.IR.loadU16(_obj, 0) * 16;
      // the key is a static literal, so canonical: its pointer is the only one to match
      for (; ptr < endPtr; ptr += 16) {
        if (Porffor.IR.loadI32(ptr, 0) == Porffor.IR.ptr(key)) {
          // first writer wins so polymorphic sites miss instead of storing each time
          if (Porffor.IR.loadI32(slot, 0) == 2147483647) Porffor.IR.storeI32(slot, 0, ptr - entriesPtr);
          if ((Porffor.IR.loadU8(ptr, 6) & 0b0001) == 0) return __Porffor_object_readValue(ptr);
          return __Porffor_object_get_withHash(_obj, key, hash);
        }
      }

      // not own: find it on the prototype chain (as get_withHash walks it) and cache a data property hit
      let proto: any = __Porffor_object_getPrototype(_obj);
      if (Porffor.type(proto) == Porffor.TYPES.undefined) proto = __Object_prototype;
      let depth: i32 = 0;
      while (Porffor.fastAnd(Porffor.type(proto) == Porffor.TYPES.object, Porffor.IR.ptr(proto) != 0, depth < 8)) {
        const e: i32 = __Porffor_object_lookupLit(proto, key);
        if (e != 0) {
          if ((Porffor.IR.loadU8(e, 6) & 0b0001) != 0) break;

          // flag the chain up to the holder: its shape changes now bump protoEpoch
          let q: any = __Porffor_object_getPrototype(_obj);
          if (Porffor.type(q) == Porffor.TYPES.undefined) q = __Object_prototype;
          while (true) {
            Porffor.IR.storeU8(q, 4, Porffor.IR.loadU8(q, 4) | 0b0010);
            if (Porffor.IR.ptr(q) == Porffor.IR.ptr(proto)) break;
            q = __Porffor_object_getPrototype(q);
            if (Porffor.type(q) == Porffor.TYPES.undefined) q = __Object_prototype;
          }

          Porffor.IR.storeI32(slot, 4, Porffor.IR.loadI32(_obj, 8));
          Porffor.IR.storeU8(slot, 20, Porffor.IR.loadU8(_obj, 5));
          Porffor.IR.storeI32(slot, 8, Porffor.IR.ptr(proto));
          Porffor.IR.storeI32(slot, 12, e - Porffor.IR.loadI32(proto, 12));
          Porffor.IR.storeI32(slot, 16, protoEpoch);
          return __Porffor_object_readValue(e);
        }

        let next: any = __Porffor_object_getPrototype(proto);
        if (Porffor.type(next) == Porffor.TYPES.undefined) next = __Object_prototype;
        if (Porffor.IR.ptr(next) == Porffor.IR.ptr(proto)) break;
        proto = next;
        depth++;
      }
    }
  }

  return __Porffor_object_get_withHash(_obj, key, hash);
};

export const __Porffor_object_get_withHash = (_obj: any, key: any, hash: i32): any => {
  let obj: any = _obj;
  const trueType: i32 = Porffor.type(obj);
  if (trueType == Porffor.TYPES.object) {
    if (Porffor.IR.ptr(obj) == 0) throw new TypeError('Cannot get property of null');
  } else {
    if (trueType == Porffor.TYPES.undefined) throw new TypeError('Cannot get property of null');
    obj = __Porffor_object_underlying(obj);
  }

  let entryPtr: i32 = 0;
  if (Porffor.type(obj) == Porffor.TYPES.object) entryPtr = __Porffor_object_lookupLit(obj, key);
  if (entryPtr == 0) {
    // check prototype chain
    if (trueType == Porffor.TYPES.object) {
      obj = __Porffor_object_getPrototype(obj);
      // if undefined, prototype is object.prototype
      if (Porffor.type(obj) == Porffor.TYPES.undefined) obj = __Object_prototype;
    } else obj = __Porffor_object_getPrototypeWithHidden(obj, trueType);

    let proto: any = obj;
    if (Porffor.type(obj) != Porffor.TYPES.object) obj = __Porffor_object_underlying(obj);
    if (obj == null) return undefined;
    while (true) {
      if ((entryPtr = __Porffor_object_lookupLit(obj, key)) != 0) break;

      // inline get prototype
      obj = __Porffor_object_getPrototype(obj);
      if (Porffor.type(obj) == Porffor.TYPES.undefined) {
        obj = __Porffor_object_getHiddenPrototype(Porffor.type(proto));
        if (Porffor.IR.ptr(obj) == Porffor.IR.ptr(proto)) obj = __Object_prototype;
      }
      if (Porffor.IR.ptr(obj) == Porffor.IR.ptr(proto)) break;

      proto = obj;
      if (Porffor.type(obj) != Porffor.TYPES.object) obj = __Porffor_object_underlying(obj);
      if (obj == null) break;
    }

    if (entryPtr == 0) return undefined;
  }

  const tail: i32 = Porffor.IR.loadU8(entryPtr, 6); // flags, plus key kind bits above
  if (tail & 0b0001) {
    // accessor descriptor
    const get: Function = __Porffor_object_accessorGet(entryPtr);

    if (Porffor.IR.ptr(get) == 0) return undefined;
    return Porffor.callThis(get, _obj);
  }

  return __Porffor_object_readValue(entryPtr);
};

export const __Porffor_object_set = (_obj: any, key: any, value: any): any => {
  let obj: any = _obj;
  const trueType: i32 = Porffor.type(obj);
  if (Porffor.type(obj) != Porffor.TYPES.object) {
    obj = __Porffor_object_underlying(obj);
    if (Porffor.type(obj) != Porffor.TYPES.object) return value;
  }

  if (Porffor.IR.ptr(obj) == 0) throw new TypeError('Cannot set property of null');

  key = ecma262.ToPropertyKey(key);
  const hash: i32 = __Porffor_object_hash(key);
  if (trueType == Porffor.TYPES.array) {
    const index: i32 = __Porffor_array_propertyKeyIndex(key);
    if (Porffor.fastAnd(index != -1, __Porffor_object_lookup(obj, key, hash) == 0)) {
      let arr: i32 = Porffor.IR.ptr(_obj);
      const needed: i32 = index + 1;
      const entries: i32 = __Porffor_array_ensure(arr, needed);
      if (needed > Porffor.IR.loadI32(arr, 0)) Porffor.IR.storeI32(arr, 0, needed);

      const entry: i32 = entries + index * 8;
      if (Porffor.fastAnd(Porffor.type(value) == Porffor.TYPES.number, value === 0, 1 / value == Infinity)) {
        Porffor.IR.storeU64(entry, 0, -2243003720663040);
      } else {
        Porffor.IR.storeJv(entry, 0, value);
      }
      Porffor.IR.gcBarrierValue(arr, Porffor.TYPES.array, value);
      return value;
    }
  }

  if (trueType == Porffor.TYPES.regexp) if (hash == -1322609992) if (Porffor.strcmp(key, 'lastIndex')) {
    Porffor.IR.storeI32(_obj, 8, ecma262.ToIntegerOrInfinity(value));
    return value;
  }

  let entryPtr: i32 = __Porffor_object_lookup(obj, key, hash);
  let flags: i32;
  if (entryPtr == 0) {
    if (hash == 212292208) if (Porffor.strcmp(key, '__proto__')) {
      // set prototype
      __Porffor_object_setPrototype(obj, value);
      return value;
    }

    // todo/opt: skip if no setters used
    // check prototype chain for setter
    let proto: any = __Porffor_object_getPrototype(obj);
    if (proto != null) {
      if (Porffor.type(proto) != Porffor.TYPES.object) proto = __Porffor_object_underlying(proto);
      let lastProto: any = proto;
      while (true) {
        if ((entryPtr = __Porffor_object_lookup(proto, key, hash)) != 0) break;

        proto = __Porffor_object_getPrototype(proto);
        if (Porffor.type(proto) != Porffor.TYPES.object) proto = __Porffor_object_underlying(proto);
        if (Porffor.fastOr(proto == null, Porffor.IR.ptr(proto) == Porffor.IR.ptr(lastProto))) break;
        lastProto = proto;
      }

      if (entryPtr != 0) {
        // found possible setter
        const tail: i32 = Porffor.IR.loadU8(entryPtr, 6); // flags, plus key kind bits above
        if (tail & 0b0001) {
          // accessor descriptor
          const set: Function = __Porffor_object_accessorSet(entryPtr);
          if (Porffor.IR.ptr(set) == 0) return value;

          Porffor.callThis(set, _obj, value);
          return value;
        }
      }
    }

    // add new entry
    // check if object is inextensible
    if (__Porffor_object_isInextensible(obj)) {
      return value;
    }

    entryPtr = __Porffor_object_appendEntry(obj, key, hash);

    // flags = writable, enumerable, configurable, not accessor
    flags = 0b1110;
  } else {
    // existing entry, modify it
    const tail: i32 = Porffor.IR.loadU8(entryPtr, 6); // flags, plus key kind bits above

    if (tail & 0b0001) {
      // accessor descriptor
      const set: Function = __Porffor_object_accessorSet(entryPtr);
      if (Porffor.IR.ptr(set) == 0) return value;

      Porffor.callThis(set, _obj, value);
      return value;
    }

    // data descriptor
    if (!(tail & 0b1000)) {
      // not writable, return now
      return value;
    }

    // flags = same flags as before
    flags = tail;
  }

  __Porffor_object_writeValue(entryPtr, value, flags);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, value);

  return value;
};

export const __Porffor_object_set_withHash = (_obj: any, key: any, value: any, hash: i32): any => {
  let obj: any = _obj;
  const trueType: i32 = Porffor.type(obj);
  if (Porffor.type(obj) != Porffor.TYPES.object) {
    obj = __Porffor_object_underlying(obj);
    if (Porffor.type(obj) != Porffor.TYPES.object) return value;
  }

  if (Porffor.IR.ptr(obj) == 0) throw new TypeError('Cannot set property of null');

  if (trueType == Porffor.TYPES.regexp) if (hash == -1322609992) if (Porffor.strcmp(key, 'lastIndex')) {
    Porffor.IR.storeI32(_obj, 8, ecma262.ToIntegerOrInfinity(value));
    return value;
  }

  let entryPtr: i32 = __Porffor_object_lookupLit(obj, key);
  let flags: i32;
  if (entryPtr == 0) {
    // todo/opt: skip if no setters used
    // check prototype chain for setter
    let proto: any = __Porffor_object_getPrototype(obj);
    if (proto != null) {
      if (Porffor.type(proto) != Porffor.TYPES.object) proto = __Porffor_object_underlying(proto);
      let lastProto: any = proto;
      while (true) {
        if ((entryPtr = __Porffor_object_lookupLit(proto, key)) != 0) break;

        proto = __Porffor_object_getPrototype(proto);
        if (Porffor.type(proto) != Porffor.TYPES.object) proto = __Porffor_object_underlying(proto);
        if (Porffor.fastOr(proto == null, Porffor.IR.ptr(proto) == Porffor.IR.ptr(lastProto))) break;
        lastProto = proto;
      }

      if (entryPtr != 0) {
        // found possible setter
        const tail: i32 = Porffor.IR.loadU8(entryPtr, 6); // flags, plus key kind bits above
        if (tail & 0b0001) {
          // accessor descriptor
          const set: Function = __Porffor_object_accessorSet(entryPtr);
          if (Porffor.IR.ptr(set) == 0) return value;

          Porffor.callThis(set, _obj, value);
          return value;
        }
      }
    }

    // add new entry
    // check if object is inextensible
    if (__Porffor_object_isInextensible(obj)) {
      return value;
    }

    entryPtr = __Porffor_object_appendEntry(obj, key, hash);

    // flags = writable, enumerable, configurable, not accessor
    flags = 0b1110;
  } else {
    // existing entry, modify it
    const tail: i32 = Porffor.IR.loadU8(entryPtr, 6); // flags, plus key kind bits above

    if (tail & 0b0001) {
      // accessor descriptor
      const set: Function = __Porffor_object_accessorSet(entryPtr);
      if (Porffor.IR.ptr(set) == 0) return value;

      Porffor.callThis(set, _obj, value);
      return value;
    }

    // data descriptor
    if (!(tail & 0b1000)) {
      // not writable, return now
      return value;
    }

    // flags = same flags as before
    flags = tail;
  }

  __Porffor_object_writeValue(entryPtr, value, flags);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, value);

  return value;
};

export const __Porffor_object_setStrict = (_obj: any, key: any, value: any): any => {
  let obj: any = _obj;
  const trueType: i32 = Porffor.type(obj);
  if (Porffor.type(obj) != Porffor.TYPES.object) {
    obj = __Porffor_object_underlying(obj);
    if (Porffor.type(obj) != Porffor.TYPES.object) return value;
  }

  if (Porffor.IR.ptr(obj) == 0) throw new TypeError('Cannot set property of null');

  key = ecma262.ToPropertyKey(key);
  const hash: i32 = __Porffor_object_hash(key);
  if (trueType == Porffor.TYPES.array) {
    const index: i32 = __Porffor_array_propertyKeyIndex(key);
    if (Porffor.fastAnd(index != -1, __Porffor_object_lookup(obj, key, hash) == 0)) {
      let arr: i32 = Porffor.IR.ptr(_obj);
      const needed: i32 = index + 1;
      const entries: i32 = __Porffor_array_ensure(arr, needed);
      if (needed > Porffor.IR.loadI32(arr, 0)) Porffor.IR.storeI32(arr, 0, needed);

      const entry: i32 = entries + index * 8;
      if (Porffor.fastAnd(Porffor.type(value) == Porffor.TYPES.number, value === 0, 1 / value == Infinity)) {
        Porffor.IR.storeU64(entry, 0, -2243003720663040);
      } else {
        Porffor.IR.storeJv(entry, 0, value);
      }
      Porffor.IR.gcBarrierValue(arr, Porffor.TYPES.array, value);
      return value;
    }
  }

  if (trueType == Porffor.TYPES.regexp) if (hash == -1322609992) if (Porffor.strcmp(key, 'lastIndex')) {
    Porffor.IR.storeI32(_obj, 8, ecma262.ToIntegerOrInfinity(value));
    return value;
  }

  let entryPtr: i32 = __Porffor_object_lookup(obj, key, hash);
  let flags: i32;
  if (entryPtr == 0) {
    if (hash == 212292208) if (Porffor.strcmp(key, '__proto__')) {
      // set prototype
      __Porffor_object_setPrototype(obj, value);
      return value;
    }

    // todo/opt: skip if no setters used
    // check prototype chain for setter
    let proto: any = __Porffor_object_getPrototype(obj);
    if (proto != null) {
      if (Porffor.type(proto) != Porffor.TYPES.object) proto = __Porffor_object_underlying(proto);

      let lastProto: any = proto;
      while (true) {
        if ((entryPtr = __Porffor_object_lookup(proto, key, hash)) != 0) break;

        proto = __Porffor_object_getPrototype(proto);
        if (Porffor.type(proto) != Porffor.TYPES.object) proto = __Porffor_object_underlying(proto);
        if (Porffor.fastOr(proto == null, Porffor.IR.ptr(proto) == Porffor.IR.ptr(lastProto))) break;
        lastProto = proto;
      }

      if (entryPtr != 0) {
        // found possible setter
        const tail: i32 = Porffor.IR.loadU8(entryPtr, 6); // flags, plus key kind bits above
        if (tail & 0b0001) {
          // accessor descriptor
          const set: Function = __Porffor_object_accessorSet(entryPtr);
          if (Porffor.IR.ptr(set) == 0) throw new TypeError('Cannot set property with only getter');

          Porffor.callThis(set, _obj, value);
          return value;
        }
      }
    }

    // add new entry
    // check if object is inextensible
    if (__Porffor_object_isInextensible(obj)) {
      throw new TypeError('Cannot add property to inextensible object');
    }

    entryPtr = __Porffor_object_appendEntry(obj, key, hash);

    // flags = writable, enumerable, configurable, not accessor
    flags = 0b1110;
  } else {
    // existing entry, modify it
    const tail: i32 = Porffor.IR.loadU8(entryPtr, 6); // flags, plus key kind bits above

    if (tail & 0b0001) {
      // accessor descriptor
      const set: Function = __Porffor_object_accessorSet(entryPtr);
      if (Porffor.IR.ptr(set) == 0) throw new TypeError('Cannot set property with only getter');

      Porffor.callThis(set, _obj, value);
      return value;
    }

    // data descriptor
    if (!(tail & 0b1000)) {
      // not writable, return now
      throw new TypeError('Cannot modify read-only property of object');
    }

    // flags = same flags as before
    flags = tail;
  }

  __Porffor_object_writeValue(entryPtr, value, flags);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, value);

  return value;
};

export const __Porffor_object_setStrict_withHash = (_obj: any, key: any, value: any, hash: i32): any => {
  let obj: any = _obj;
  const trueType: i32 = Porffor.type(obj);
  if (Porffor.type(obj) != Porffor.TYPES.object) {
    obj = __Porffor_object_underlying(obj);
    if (Porffor.type(obj) != Porffor.TYPES.object) return value;
  }

  if (Porffor.IR.ptr(obj) == 0) throw new TypeError('Cannot set property of null');

  if (trueType == Porffor.TYPES.regexp) if (hash == -1322609992) if (Porffor.strcmp(key, 'lastIndex')) {
    Porffor.IR.storeI32(_obj, 8, ecma262.ToIntegerOrInfinity(value));
    return value;
  }

  let entryPtr: i32 = __Porffor_object_lookupLit(obj, key);
  let flags: i32;
  if (entryPtr == 0) {
    // todo/opt: skip if no setters used
    // check prototype chain for setter
    let proto: any = __Porffor_object_getPrototype(obj);
    if (proto != null) {
      if (Porffor.type(proto) != Porffor.TYPES.object) proto = __Porffor_object_underlying(proto);

      let lastProto: any = proto;
      while (true) {
        if ((entryPtr = __Porffor_object_lookupLit(proto, key)) != 0) break;

        proto = __Porffor_object_getPrototype(proto);
        if (Porffor.type(proto) != Porffor.TYPES.object) proto = __Porffor_object_underlying(proto);
        if (Porffor.fastOr(proto == null, Porffor.IR.ptr(proto) == Porffor.IR.ptr(lastProto))) break;
        lastProto = proto;
      }

      if (entryPtr != 0) {
        // found possible setter
        const tail: i32 = Porffor.IR.loadU8(entryPtr, 6); // flags, plus key kind bits above
        if (tail & 0b0001) {
          // accessor descriptor
          const set: Function = __Porffor_object_accessorSet(entryPtr);
          if (Porffor.IR.ptr(set) == 0) throw new TypeError('Cannot set property with only getter');

          Porffor.callThis(set, _obj, value);
          return value;
        }
      }
    }

    // add new entry
    // check if object is inextensible
    if (__Porffor_object_isInextensible(obj)) {
      throw new TypeError('Cannot add property to inextensible object');
    }

    entryPtr = __Porffor_object_appendEntry(obj, key, hash);

    // flags = writable, enumerable, configurable, not accessor
    flags = 0b1110;
  } else {
    // existing entry, modify it
    const tail: i32 = Porffor.IR.loadU8(entryPtr, 6); // flags, plus key kind bits above

    if (tail & 0b0001) {
      // accessor descriptor
      const set: Function = __Porffor_object_accessorSet(entryPtr);
      if (Porffor.IR.ptr(set) == 0) throw new TypeError('Cannot set property with only getter');

      Porffor.callThis(set, _obj, value);
      return value;
    }

    // data descriptor
    if (!(tail & 0b1000)) {
      // not writable, return now
      throw new TypeError('Cannot modify read-only property of object');
    }

    // flags = same flags as before
    flags = tail;
  }

  __Porffor_object_writeValue(entryPtr, value, flags);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, value);

  return value;
};

export const __Porffor_object_define = (obj: any, key: any, value: any, flags: i32): void => {
  if (Porffor.type(obj) != Porffor.TYPES.object) {
    obj = __Porffor_object_underlying(obj);
    if (Porffor.type(obj) != Porffor.TYPES.object) return;
  }

  const hash: i32 = __Porffor_object_hash(key);
  let entryPtr: i32 = __Porffor_object_lookup(obj, key, hash);
  if (entryPtr == 0) {
    // add new entry
    // check if object is inextensible
    if (__Porffor_object_isInextensible(obj)) {
      throw new TypeError('Cannot define property, object is inextensible');
    }

    entryPtr = __Porffor_object_appendEntry(obj, key, hash);
  } else {
    // existing entry, check and maybe modify it
    const tail: i32 = Porffor.IR.loadU8(entryPtr, 6); // flags, plus key kind bits above

    if ((tail & 0b0010) == 0) {
      // not already configurable, check to see if we can redefine
      let err: boolean = false;

      // descriptor type (accessor/data) and/or flags (other than writable) have changed
      if ((tail & 0b0111) != (flags & 0b0111)) {
        err = true;
      } else if ((tail & 0b1000) == 0) {
        // already non-writable only checks
        // trying to change writable false -> true
        if (flags & 0b1000) {
          err = true;
        } else {
          // if already non-writable, check value isn't being changed
          err = !__Object_is(__Porffor_object_readValue(entryPtr), value);
        }
      }

      if (err) throw new TypeError('Cannot redefine property');
    }
  }

  __Porffor_object_writeValue(entryPtr, value, flags);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, value);
};

export const __Porffor_object_defineAccessor = (obj: any, key: any, get: any, set: any, flags: i32): void => {
  if (Porffor.type(obj) != Porffor.TYPES.object) {
    obj = __Porffor_object_underlying(obj);
    if (Porffor.type(obj) != Porffor.TYPES.object) return;
  }

  const hash: i32 = __Porffor_object_hash(key);
  let entryPtr: i32 = __Porffor_object_lookup(obj, key, hash);
  const getRaw: i32 = Porffor.IR.ptr(get);
  const setRaw: i32 = Porffor.IR.ptr(set);

  if (entryPtr == 0) {
    // add new entry
    // check if object is inextensible
    if (__Porffor_object_isInextensible(obj)) {
      throw new TypeError('Cannot define property, object is inextensible');
    }

    entryPtr = __Porffor_object_appendEntry(obj, key, hash);
  } else {
    // existing entry, check and maybe modify it
    const tail: i32 = Porffor.IR.loadU8(entryPtr, 6); // flags, plus key kind bits above

    if ((tail & 0b0010) == 0) {
      // not already configurable, check to see if we can redefine
      let err: boolean = false;

      // descriptor type (accessor/data) and/or flags (other than writable) have changed
      if ((tail & 0b0111) != (flags & 0b0111)) {
        err = true;
      } else if ((tail & 0b1000) == 0) {
        // trying to change writable false -> true
        if (flags & 0b1000) err = true;
        if (Porffor.IR.loadI32(entryPtr, 8) != getRaw) err = true;
        if (Porffor.IR.loadI32(entryPtr, 12) != setRaw) err = true;
      }

      if (err) throw new TypeError('Cannot redefine property');
    }
  }

  __Porffor_object_writeAccessor(entryPtr, getRaw, setRaw);

  __Porffor_object_writeFlags(entryPtr, flags);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, get);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, set);
};

export const __Porffor_object_delete = (obj: any, key: any): boolean => {
  if (Porffor.IR.ptr(obj) == 0) throw new TypeError('Cannot delete property of null');

  const trueType: i32 = Porffor.type(obj);
  if (trueType == Porffor.TYPES.array) {
    const index: i32 = __Porffor_array_propertyKeyIndex(ecma262.ToPropertyKey(key));
    if (index != -1) {
      __Porffor_array_delete(obj as any[], index);
      return true;
    }
  }

  if (Porffor.type(obj) != Porffor.TYPES.object) {
    obj = __Porffor_object_underlying(obj);
    if (Porffor.type(obj) != Porffor.TYPES.object) return true;
  }

  const entryPtr: i32 = __Porffor_object_lookup(obj, key, __Porffor_object_hash(key));
  if (entryPtr == 0) {
    // not found, stop
    return true;
  }

  const tail: i32 = Porffor.IR.loadU8(entryPtr, 6); // flags, plus key kind bits above
  if (!(tail & 0b0010)) {
    // not configurable
    return false;
  }

  const ind: i32 = (entryPtr - __Porffor_object_entriesPtr(obj)) / 16;

  // decrement size
  __Porffor_object_protoChanged(obj);
  let size: i32 = Porffor.IR.loadU16(obj, 0);
  Porffor.IR.storeU16(obj, 0, --size);

  if (size > ind) {
    Porffor.IR.copy(entryPtr, entryPtr + 16, (size - ind) * 16);
  }

  return true;
};

export const __Porffor_object_deleteStrict = (obj: any, key: any): boolean => {
  if (Porffor.IR.ptr(obj) == 0) throw new TypeError('Cannot delete property of null');

  const trueType: i32 = Porffor.type(obj);
  if (trueType == Porffor.TYPES.array) {
    const index: i32 = __Porffor_array_propertyKeyIndex(ecma262.ToPropertyKey(key));
    if (index != -1) {
      __Porffor_array_delete(obj as any[], index);
      return true;
    }
  }

  if (Porffor.type(obj) != Porffor.TYPES.object) {
    obj = __Porffor_object_underlying(obj);
    if (Porffor.type(obj) != Porffor.TYPES.object) return true;
  }

  const entryPtr: i32 = __Porffor_object_lookup(obj, key, __Porffor_object_hash(key));
  if (entryPtr == 0) {
    // not found, stop
    return true;
  }

  const tail: i32 = Porffor.IR.loadU8(entryPtr, 6); // flags, plus key kind bits above
  if (!(tail & 0b0010)) {
    // not configurable
    throw new TypeError('Cannot delete non-configurable property of object');
  }

  const ind: i32 = (entryPtr - __Porffor_object_entriesPtr(obj)) / 16;

  // decrement size
  __Porffor_object_protoChanged(obj);
  let size: i32 = Porffor.IR.loadU16(obj, 0);
  Porffor.IR.storeU16(obj, 0, --size);

  if (size > ind) {
    Porffor.IR.copy(entryPtr, entryPtr + 16, (size - ind) * 16);
  }

  return true;
};


export const __Porffor_object_isEnumerable = (entryPtr: i32): boolean => {
  return (Porffor.IR.loadU8(entryPtr, 6) & 0b0100) != 0;
};


// used for { foo: 5 }
export const __Porffor_object_expr_init = (obj: any, key: any, value: any): void => {
  if (Porffor.type(obj) != Porffor.TYPES.object) obj = __Porffor_object_underlying(obj);

  const hash: i32 = __Porffor_object_hash(key);
  let entryPtr: i32 = __Porffor_object_lookup(obj, key, hash);
  if (entryPtr == 0) {
    if (hash == 212292208) if (Porffor.strcmp(key, '__proto__')) {
      // set prototype
      __Porffor_object_setPrototype(obj, value);
      return value;
    }

    // add new entry
    entryPtr = __Porffor_object_appendEntry(obj, key, hash);
  }

  __Porffor_object_writeValue(entryPtr, value, 0b1110);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, value);
};

// used for { get foo() {} }
export const __Porffor_object_expr_get = (obj: any, key: any, get: any): void => {
  if (Porffor.type(obj) != Porffor.TYPES.object) obj = __Porffor_object_underlying(obj);

  const hash: i32 = __Porffor_object_hash(key);
  let entryPtr: i32 = __Porffor_object_lookup(obj, key, hash);
  let set: any = undefined;
  if (entryPtr == 0) {
    // add new entry
    entryPtr = __Porffor_object_appendEntry(obj, key, hash);
  } else if (Porffor.IR.loadU8(entryPtr, 6) & 0b0001) {
    // existing entry, keep set (if exists)
    set = __Porffor_object_accessorSet(entryPtr);
  }

  // write new accessor pair
  __Porffor_object_writeAccessor(entryPtr, get, set);

  // flags = writable, enumerable, configurable, accessor
  __Porffor_object_writeFlags(entryPtr, 0b1111);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, get);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, set);
};

// used for { set foo(v) {} }
export const __Porffor_object_expr_set = (obj: any, key: any, set: any): void => {
  if (Porffor.type(obj) != Porffor.TYPES.object) obj = __Porffor_object_underlying(obj);

  const hash: i32 = __Porffor_object_hash(key);
  let entryPtr: i32 = __Porffor_object_lookup(obj, key, hash);
  let get: any = undefined;
  if (entryPtr == 0) {
    // add new entry
    entryPtr = __Porffor_object_appendEntry(obj, key, hash);
  } else if (Porffor.IR.loadU8(entryPtr, 6) & 0b0001) {
    // existing entry, keep get (if exists)
    get = __Porffor_object_accessorGet(entryPtr);
  }

  // write new accessor pair
  __Porffor_object_writeAccessor(entryPtr, get, set);

  // flags = writable, enumerable, configurable, accessor
  __Porffor_object_writeFlags(entryPtr, 0b1111);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, get);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, set);
};


// used for { foo: 5 }
export const __Porffor_object_class_value = (obj: any, key: any, value: any): void => {
  if (Porffor.type(obj) != Porffor.TYPES.object) obj = __Porffor_object_underlying(obj);

  const hash: i32 = __Porffor_object_hash(key);
  let entryPtr: i32 = __Porffor_object_lookup(obj, key, hash);
  if (entryPtr == 0) {
    // add new entry
    // check if object is inextensible
    if (__Porffor_object_isInextensible(obj)) {
      throw new TypeError('Cannot define property, object is inextensible');
    }

    entryPtr = __Porffor_object_appendEntry(obj, key, hash);
  }

  __Porffor_object_writeValue(entryPtr, value, 0b1110);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, value);
};

// used for { foo() {} }
export const __Porffor_object_class_method = (obj: any, key: any, value: any): void => {
  if (Porffor.type(obj) != Porffor.TYPES.object) obj = __Porffor_object_underlying(obj);

  const hash: i32 = __Porffor_object_hash(key);
  let entryPtr: i32 = __Porffor_object_lookup(obj, key, hash);
  if (entryPtr == 0) {
    // add new entry
    // check if object is inextensible
    if (__Porffor_object_isInextensible(obj)) {
      throw new TypeError('Cannot define property, object is inextensible');
    }

    entryPtr = __Porffor_object_appendEntry(obj, key, hash);
  }

  __Porffor_object_writeValue(entryPtr, value, 0b1010);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, value);
};

// used for { get foo() {} }
export const __Porffor_object_class_get = (obj: any, key: any, get: any): void => {
  if (Porffor.type(obj) != Porffor.TYPES.object) obj = __Porffor_object_underlying(obj);

  const hash: i32 = __Porffor_object_hash(key);
  let entryPtr: i32 = __Porffor_object_lookup(obj, key, hash);
  let set: any = undefined;
  if (entryPtr == 0) {
    // add new entry
    // check if object is inextensible
    if (__Porffor_object_isInextensible(obj)) {
      throw new TypeError('Cannot define property, object is inextensible');
    }

    entryPtr = __Porffor_object_appendEntry(obj, key, hash);
  } else if (Porffor.IR.loadU8(entryPtr, 6) & 0b0001) {
    // existing entry, keep set (if exists)
    set = __Porffor_object_accessorSet(entryPtr);
  }

  // write new accessor pair
  __Porffor_object_writeAccessor(entryPtr, get, set);

  // flags = writable, enumerable, configurable, accessor
  __Porffor_object_writeFlags(entryPtr, 0b1011);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, get);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, set);
};

// used for { set foo(v) {} }
export const __Porffor_object_class_set = (obj: any, key: any, set: any): void => {
  if (Porffor.type(obj) != Porffor.TYPES.object) obj = __Porffor_object_underlying(obj);

  const hash: i32 = __Porffor_object_hash(key);
  let entryPtr: i32 = __Porffor_object_lookup(obj, key, hash);
  let get: any = undefined;
  if (entryPtr == 0) {
    // add new entry
    // check if object is inextensible
    if (__Porffor_object_isInextensible(obj)) {
      throw new TypeError('Cannot define property, object is inextensible');
    }

    entryPtr = __Porffor_object_appendEntry(obj, key, hash);
  } else if (Porffor.IR.loadU8(entryPtr, 6) & 0b0001) {
    // existing entry, keep get (if exists)
    get = __Porffor_object_accessorGet(entryPtr);
  }

  // write new accessor pair
  __Porffor_object_writeAccessor(entryPtr, get, set);

  // flags = writable, enumerable, configurable, accessor
  __Porffor_object_writeFlags(entryPtr, 0b1011);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, get);
  Porffor.IR.gcBarrierValue(obj, Porffor.TYPES.object, set);
};
