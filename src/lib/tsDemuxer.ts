export function isTsStream(data: Uint8Array): boolean {
  return data.length >= 188 && data[0] === 0x47;
}

export function isAacStream(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0xff && (data[1] & 0xf0) === 0xf0;
}

export function extractAacFromTs(tsData: Uint8Array): Uint8Array {
  const len = tsData.length;
  let audioPid = -1;
  let pmtPid = -1;

  for (let i = 0; i + 188 <= len; i += 188) {
    if (tsData[i] !== 0x47) continue;
    const pid = ((tsData[i + 1] & 0x1f) << 8) | tsData[i + 2];
    const payloadStart = (tsData[i + 1] & 0x40) !== 0;
    const adaptCtrl = (tsData[i + 3] >> 4) & 0x03;
    let payloadOffset = i + 4;
    if (adaptCtrl === 2) continue;
    if (adaptCtrl === 3) payloadOffset += 1 + tsData[payloadOffset];
    if (payloadOffset >= i + 188) continue;

    if (pid === 0 && payloadStart) {
      const pointer = tsData[payloadOffset];
      const tableStart = payloadOffset + 1 + pointer;
      if (tableStart + 12 < i + 188) {
        pmtPid = ((tsData[tableStart + 10] & 0x1f) << 8) | tsData[tableStart + 11];
      }
    } else if (pid === pmtPid && payloadStart) {
      const pointer = tsData[payloadOffset];
      const pmtIdx = payloadOffset + 1 + pointer;
      const sectionLen = ((tsData[pmtIdx + 1] & 0x0f) << 8) | tsData[pmtIdx + 2];
      const programInfoLen = ((tsData[pmtIdx + 8] & 0x0f) << 8) | tsData[pmtIdx + 9];
      let esIdx = pmtIdx + 12 + programInfoLen;
      const endEs = pmtIdx + 3 + sectionLen - 4;
      while (esIdx + 5 <= endEs && esIdx < i + 188) {
        const streamType = tsData[esIdx];
        const esPid = ((tsData[esIdx + 1] & 0x1f) << 8) | tsData[esIdx + 2];
        const esInfoLen = ((tsData[esIdx + 3] & 0x0f) << 8) | tsData[esIdx + 4];
        if (
          streamType === 0x0f ||
          streamType === 0x03 ||
          streamType === 0x04 ||
          streamType === 0x11
        ) {
          audioPid = esPid;
          break;
        }
        esIdx += 5 + esInfoLen;
      }
    }
  }

  if (audioPid === -1) {
    for (let i = 0; i + 188 <= len; i += 188) {
      if (tsData[i] !== 0x47) continue;
      const payloadStart = (tsData[i + 1] & 0x40) !== 0;
      if (!payloadStart) continue;
      const pid = ((tsData[i + 1] & 0x1f) << 8) | tsData[i + 2];
      if (pid === 0 || pid === pmtPid) continue;
      const adaptCtrl = (tsData[i + 3] >> 4) & 0x03;
      let offset = i + 4;
      if (adaptCtrl === 2) continue;
      if (adaptCtrl === 3) offset += 1 + tsData[offset];
      if (offset + 4 <= i + 188) {
        if (tsData[offset] === 0 && tsData[offset + 1] === 0 && tsData[offset + 2] === 1) {
          const streamId = tsData[offset + 3];
          if (streamId >= 0xc0 && streamId <= 0xdf) {
            audioPid = pid;
            break;
          }
        }
      }
    }
  }

  if (audioPid === -1) {
    return tsData;
  }

  const chunks: Uint8Array[] = [];
  for (let i = 0; i + 188 <= len; i += 188) {
    if (tsData[i] !== 0x47) continue;
    const pid = ((tsData[i + 1] & 0x1f) << 8) | tsData[i + 2];
    if (pid !== audioPid) continue;

    const payloadStart = (tsData[i + 1] & 0x40) !== 0;
    const adaptCtrl = (tsData[i + 3] >> 4) & 0x03;
    let offset = i + 4;
    if (adaptCtrl === 2) continue;
    if (adaptCtrl === 3) offset += 1 + tsData[offset];
    if (offset >= i + 188) continue;

    if (payloadStart) {
      if (
        offset + 9 <= i + 188 &&
        tsData[offset] === 0 &&
        tsData[offset + 1] === 0 &&
        tsData[offset + 2] === 1
      ) {
        const pesHeaderDataLen = tsData[offset + 8];
        const aacStart = offset + 9 + pesHeaderDataLen;
        if (aacStart < i + 188) {
          chunks.push(tsData.subarray(aacStart, i + 188));
        }
      }
    } else {
      chunks.push(tsData.subarray(offset, i + 188));
    }
  }

  let totalBytes = 0;
  for (const c of chunks) totalBytes += c.length;
  if (totalBytes === 0) {
    return tsData;
  }

  const result = new Uint8Array(totalBytes);
  let cur = 0;
  for (const c of chunks) {
    result.set(c, cur);
    cur += c.length;
  }
  return result;
}
