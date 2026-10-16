import fs from 'node:fs';
import path from 'node:path';

const MIME_BY_EXTENSION = {
  '.opus': 'audio/ogg; codecs=opus',
  '.ogg': 'audio/ogg',
  '.webm': 'audio/webm; codecs=opus',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mpeg': 'audio/mpeg',
};

export function mediaContentType(filePath) {
  return MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export function streamLocalMedia(req, res, filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: '404', desc: '音频缓存不存在，请先下载或重新下载' }));
    return;
  }
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const contentType = mediaContentType(filePath);
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=0, must-revalidate',
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(range.trim());
  if (!match) {
    res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
    res.end();
    return;
  }
  const size = BigInt(fileSize);
  let first, last;
  if (match[1]) {
    first = BigInt(match[1]);
    last = match[2] ? BigInt(match[2]) : size - 1n;
    if (last >= size) last = size - 1n;
  } else {
    const suffix = match[2] ? BigInt(match[2]) : 0n;
    first = suffix > 0n ? (suffix >= size ? 0n : size - suffix) : size;
    last = size - 1n;
  }
  if (first < 0n || first >= size || last < first) {
    res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
    res.end();
    return;
  }
  const start = Number(first), end = Number(last);

  res.writeHead(206, {
    'Accept-Ranges': 'bytes',
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Content-Length': end - start + 1,
    'Content-Type': contentType,
    'Cache-Control': 'private, max-age=0, must-revalidate',
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
}
