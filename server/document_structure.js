// Structure-aware, lossless boundaries. Page identity is supplied by the caller.
export function splitStructured(text, max = 1100) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const blocks = []; let block = [], fence = '';
  const flush = () => { if (block.length) blocks.push(block.join('\n')); block = []; };
  for (const line of lines) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (!fence && /^#{1,6}\s/.test(line)) flush();
    block.push(line);
    if (marker) { if (!fence) fence = marker[0]; else if (marker[0] === fence) fence = ''; }
    if (!fence && !line.trim()) flush();
  }
  flush();
  const result = []; let current = '';
  const push = () => { if (current.trim()) result.push(current.trim()); current = ''; };
  for (const b of blocks) {
    if (/^#{1,6}\s/.test(b)) push();
    if (current.length + b.length + 1 > max) push();
    let rest = b;
    while (rest.length > max) {
      // Prefer a row, sentence or word boundary; never drop residual text.
      const prefix = rest.slice(0, max);
      const boundaries = [...prefix.matchAll(/\n|[。！？!?；;]\s*|\s+/g)];
      const last = boundaries.at(-1);
      const end = last && last.index > max / 3 ? last.index + last[0].length : max;
      result.push(rest.slice(0, end).trim()); rest = rest.slice(end);
    }
    current += (current ? '\n' : '') + rest;
  }
  push();
  return result.filter(Boolean);
}

// Mammoth produces HTML locally. Convert its structural tags to indexable text;
// HTML is never rendered or executed, including document links and embedded images.
export function officeHtmlText(html) {
  const tables=html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_,table)=>'\n\n'+[...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(row=>'| '+[...row[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map(cell=>cell[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()).join(' | ')+' |').join('\n')+'\n\n');
  return tables.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, s) => `\n\n${'#'.repeat(+n)} ${s}\n\n`)
    .replace(/<\/(?:p|table|ul|ol)>/gi, '\n\n').replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<tr[^>]*>/gi, '\n| ').replace(/<\/(?:td|th)>/gi, ' | ')
    .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => { const c = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1),16) : +n; return c <= 0x10ffff ? String.fromCodePoint(c) : ''; })
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim();
}
