/** Marching squares for a scalar field sampled on a rectilinear grid. `grid[j][i]` is (xs[i], ys[j]). */
export function contourLines(grid: number[][], xs: number[], ys: number[], level: number): number[][][] {
  const segments: Array<[number, number, number, number]> = [];
  const rows = ys.length;
  const cols = xs.length;
  for (let j = 0; j < rows - 1; j += 1) {
    for (let i = 0; i < cols - 1; i += 1) {
      const row = grid[j];
      const rowUp = grid[j + 1];
      if (!row || !rowUp) continue;
      const v00 = row[i];
      const v10 = row[i + 1];
      const v01 = rowUp[i];
      const v11 = rowUp[i + 1];
      if (![v00, v10, v11, v01].every((value) => Number.isFinite(value))) continue;
      const bl = (v00 ?? 0) >= level;
      const br = (v10 ?? 0) >= level;
      const tr = (v11 ?? 0) >= level;
      const tl = (v01 ?? 0) >= level;
      const code = (bl ? 1 : 0) | (br ? 2 : 0) | (tr ? 4 : 0) | (tl ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const x0 = xs[i] ?? 0;
      const x1 = xs[i + 1] ?? x0;
      const y0 = ys[j] ?? 0;
      const y1 = ys[j + 1] ?? y0;
      const bottom: [number, number] = [lerp(x0, x1, v00 ?? 0, v10 ?? 0, level), y0];
      const right: [number, number] = [x1, lerp(y0, y1, v10 ?? 0, v11 ?? 0, level)];
      const top: [number, number] = [lerp(x0, x1, v01 ?? 0, v11 ?? 0, level), y1];
      const left: [number, number] = [x0, lerp(y0, y1, v00 ?? 0, v01 ?? 0, level)];
      const push = (a: [number, number], b: [number, number]) => {
        segments.push([a[0], a[1], b[0], b[1]]);
      };
      const center = ((v00 ?? 0) + (v10 ?? 0) + (v11 ?? 0) + (v01 ?? 0)) / 4;
      switch (code) {
        case 1:
          push(left, bottom);
          break;
        case 2:
          push(bottom, right);
          break;
        case 3:
          push(left, right);
          break;
        case 4:
          push(right, top);
          break;
        case 5:
          if (center >= level) {
            push(bottom, right);
            push(left, top);
          } else {
            push(left, bottom);
            push(right, top);
          }
          break;
        case 6:
          push(bottom, top);
          break;
        case 7:
          push(left, top);
          break;
        case 8:
          push(left, top);
          break;
        case 9:
          push(bottom, top);
          break;
        case 10:
          if (center >= level) {
            push(bottom, left);
            push(right, top);
          } else {
            push(bottom, right);
            push(left, top);
          }
          break;
        case 11:
          push(right, top);
          break;
        case 12:
          push(left, right);
          break;
        case 13:
          push(bottom, right);
          break;
        case 14:
          push(left, bottom);
          break;
        default:
          break;
      }
    }
  }
  return stitch(segments);
}

function lerp(a: number, b: number, va: number, vb: number, level: number): number {
  const delta = vb - va;
  const t = Math.abs(delta) < 1e-12 ? 0.5 : (level - va) / delta;
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

function stitch(segments: Array<[number, number, number, number]>): number[][][] {
  const unused = segments.map((segment) => ({ segment, used: false }));
  const key = (x: number, y: number) => `${x.toFixed(4)},${y.toFixed(4)}`;
  const lines: number[][][] = [];
  for (const entry of unused) {
    if (entry.used) continue;
    entry.used = true;
    const [ax, ay, bx, by] = entry.segment;
    const poly: number[][] = [
      [ax, ay],
      [bx, by],
    ];
    let grew = true;
    while (grew) {
      grew = false;
      const end = poly[poly.length - 1];
      if (!end) break;
      const endKey = key(end[0] ?? 0, end[1] ?? 0);
      for (const candidate of unused) {
        if (candidate.used) continue;
        const [cx, cy, dx, dy] = candidate.segment;
        if (key(cx, cy) === endKey) {
          poly.push([dx, dy]);
          candidate.used = true;
          grew = true;
          break;
        }
        if (key(dx, dy) === endKey) {
          poly.push([cx, cy]);
          candidate.used = true;
          grew = true;
          break;
        }
      }
    }
    if (poly.length > 1) lines.push(poly);
  }
  return lines;
}

export function sampleGrid(
  evaluate: (x: number, y: number) => number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  nx: number,
  ny: number,
): { grid: number[][]; xs: number[]; ys: number[] } | null {
  if (!(xMax > xMin) || !(yMax > yMin)) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < nx; i += 1) xs.push(xMin + ((xMax - xMin) * i) / (nx - 1));
  for (let j = 0; j < ny; j += 1) ys.push(yMin + ((yMax - yMin) * j) / (ny - 1));
  const grid: number[][] = [];
  let finite = 0;
  for (let j = 0; j < ny; j += 1) {
    const row: number[] = [];
    for (let i = 0; i < nx; i += 1) {
      const value = evaluate(xs[i] ?? 0, ys[j] ?? 0);
      row.push(value);
      if (Number.isFinite(value)) finite += 1;
    }
    grid.push(row);
  }
  if (finite < (nx * ny) / 4) return null;
  return { grid, xs, ys };
}
