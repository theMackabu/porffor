import type {} from './porffor.d.ts';

export const __Porffor_mallocShared = (bytes: i32): i32 => Porffor.malloc(bytes);

export const __Porffor_array_unpackI32 = (arr: i32): void => {
  Porffor.c`if (PORF_ARR_I32((u32)arr)) porf_arr_unpack_i32((u32)arr);`;
};

export const __Porffor_array_ensure = (arr: i32, needed: i32): i32 => {
  Porffor.c`porf_arr_grow((u32)arr, needed);
  return (i32)PORF_ARR_RAW((u32)arr);`;
  return 0;
};

export const __Porffor_array_new = (capacity: i32): any[] => {
  const arr: any[] = Porffor.malloc(16 + capacity * 8);
  Porffor.IR.storeI32(arr, 0, 0);
  Porffor.IR.storeI32(arr, 4, Porffor.IR.ptr(arr) + 16);
  Porffor.IR.storeI32(arr, 8, capacity);
  Porffor.IR.fill(Porffor.IR.ptr(arr) + 16, 0, capacity * 8);
  return arr;
};

export const __Porffor_array_has = (arr: any[], index: i32): boolean => {
  if (Porffor.fastOr(index < 0, index >= arr.length, index >= Porffor.IR.loadI32(arr, 8))) return false;
  const entries: i32 = Porffor.IR.loadI32(arr, 4);
  if (entries & 1) return true;
  return Porffor.IR.loadU64((entries & -4) + index * 8, 0) != 0;
};

export const __Porffor_array_delete = (arr: any[], i: i32): void => {
  if (i < 0) return;
  Porffor.c`porf_arr_delete((u32)arr.val, (u32)i);`;
};

export const __Porffor_array_setLength = (arr: any[], newLen: any): void => {
  Porffor.c`porf_arr_set_len((u32)arr.val, (u32)newLen.val);`;
};
