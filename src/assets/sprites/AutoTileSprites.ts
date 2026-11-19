const CLIFF_BASE: readonly string[] = [
  'fffffeffffeeffff',
  'fffe2efeeffeffff',
  'ffddffffdfffdfff',
  'ffffffffffffffff',
  'eeffeffffeffffef',
  'efffffffefeeffff',
  'dfffdffffffddfff',
  'ffff1ffffffff1ff',
  'fffffefffeffffff',
  'fffe2efeefffeeff',
  'ffddffffffdfffdf',
  'ffffffffffffffff',
  'efffffeffffeffff',
  'ffeefffffffeefee',
  'ffffdfffddffffff',
  'fffdfdfffffffddf',
];

const GRASS_EARTH_BASE: readonly string[] = [
  '3333933333933333',
  '3993333933333933',
  '3333393333933339',
  '3393333393339333',
  '9333993333333393',
  '3333333933933333',
  '3393333333339933',
  '333393f339333339',
  '3933333333393333',
  '3333933933333933',
  '9393333339333393',
  '33333933333f9333',
  '3393333933333339',
  '3333933339393333',
  '9333339333333933',
  '3339333333933333',
];

const GRASS_TOP_ROWS: readonly string[] = [
  '1111111111111111',
  '6266266626626662',
  '6676662667666766',
  '7677677677677767',
  '7717677177176771',
  '11.1771111.17711',
  '....11......11..',
];

function cloneGrid(rows: readonly string[]): string[][] {
  return rows.map((r) => r.split(''));
}

function buildCliffTile(mask: number): string[] {
  const hasN = (mask & 1) !== 0;
  const hasE = (mask & 2) !== 0;
  const hasS = (mask & 4) !== 0;
  const hasW = (mask & 8) !== 0;
  const g = cloneGrid(CLIFF_BASE);

  if (!hasN) {
    for (let x = 0; x < 16; x++) {
      g[0][x] = '1';
      g[1][x] = x % 5 === 3 ? 'e' : '2';
      g[2][x] = x === 4 || x === 11 ? '2' : x % 4 === 2 ? 'f' : 'e';
    }
    g[3][4] = 'd';
    g[3][5] = 'd';
    g[3][11] = 'd';
    g[3][12] = 'd';
  }

  if (!hasW) {
    for (let y = 0; y < 16; y++) {
      g[y][0] = '1';
      if (y >= 1 && y <= 14) {
        g[y][1] = y <= 2 || y === 5 || y === 10 ? '2' : y % 4 === 3 ? 'f' : 'e';
      }
    }
  }

  if (!hasE) {
    for (let y = 0; y < 16; y++) {
      g[y][15] = '1';
      if (y >= 1 && y <= 14) {
        if (!hasN && y === 1) {
          g[y][14] = 'e';
        } else {
          g[y][14] = y === 6 || y === 11 || y >= 13 ? 'b' : 'd';
        }
      }
    }
  }

  if (!hasS) {
    for (let x = 0; x < 16; x++) {
      g[15][x] = '1';
      if (x >= 1 && x <= 14) {
        g[14][x] = x === 4 || x === 9 ? '1' : 'b';
        g[13][x] = x === 2 || x === 7 || x === 11 ? 'b' : 'd';
      }
    }
    if (hasW) {
      g[14][0] = 'b';
      g[13][0] = 'd';
    }
    if (hasE) {
      g[14][15] = 'b';
      g[13][15] = 'd';
    }
  }

  if (!hasN && !hasW) {
    g[0][0] = '.';
    g[0][1] = '1';
    g[1][0] = '1';
    g[1][1] = '1';
    g[1][2] = '2';
    g[2][1] = 'e';
  }
  if (!hasN && !hasE) {
    g[0][15] = '.';
    g[0][14] = '1';
    g[1][15] = '1';
    g[1][14] = '1';
    g[1][13] = 'e';
    g[2][14] = 'd';
  }
  if (!hasS && !hasW) {
    g[15][0] = '.';
    g[15][1] = '1';
    g[14][0] = '1';
    g[14][1] = '1';
    g[14][2] = 'b';
    g[13][1] = 'd';
  }
  if (!hasS && !hasE) {
    g[15][15] = '.';
    g[15][14] = '1';
    g[14][15] = '1';
    g[14][14] = '1';
    g[14][13] = 'b';
    g[13][14] = 'b';
  }

  return g.map((r) => r.join(''));
}

function buildGrassTile(mask: number): string[] {
  const hasN = (mask & 1) !== 0;
  const hasE = (mask & 2) !== 0;
  const hasS = (mask & 4) !== 0;
  const hasW = (mask & 8) !== 0;
  const g = cloneGrid(GRASS_EARTH_BASE);

  if (!hasN) {
    for (let y = 0; y < GRASS_TOP_ROWS.length; y++) {
      const row = GRASS_TOP_ROWS[y];
      for (let x = 0; x < 16; x++) {
        const ch = row[x];
        if (ch !== '.') g[y][x] = ch;
      }
    }
  } else {
    g[0][3] = '7';
    g[0][11] = '7';
    g[1][7] = '9';
  }

  if (!hasW) {
    for (let y = 0; y < 16; y++) {
      g[y][0] = '1';
      if (y >= (hasN ? 0 : 6) && y <= 14) {
        g[y][1] = y === 9 || y === 12 ? '2' : '3';
      }
    }
  }

  if (!hasE) {
    for (let y = 0; y < 16; y++) {
      g[y][15] = '1';
      if (y >= (hasN ? 0 : 6) && y <= 14) {
        g[y][14] = y % 4 === 0 ? 'b' : '9';
      } else if (!hasN && y >= 1 && y <= 3) {
        g[y][14] = '7';
      }
    }
  }

  if (!hasS) {
    for (let x = 0; x < 16; x++) {
      g[15][x] = '1';
      if (x >= 1 && x <= 14) {
        g[14][x] = x === 4 || x === 9 ? '1' : 'b';
        g[13][x] = x === 2 || x === 7 || x === 11 ? 'b' : '9';
      }
    }
    if (hasW) {
      g[14][0] = 'b';
      g[13][0] = '9';
    }
    if (hasE) {
      g[14][15] = 'b';
      g[13][15] = '9';
    }
  }

  if (!hasN && !hasW) {
    g[0][0] = '.';
    g[0][1] = '1';
    g[1][0] = '1';
    g[1][1] = '1';
    g[1][2] = '2';
    g[2][1] = '6';
  }
  if (!hasN && !hasE) {
    g[0][15] = '.';
    g[0][14] = '1';
    g[1][15] = '1';
    g[1][14] = '1';
    g[1][13] = '6';
    g[2][14] = '7';
  }
  if (!hasS && !hasW) {
    g[15][0] = '.';
    g[15][1] = '1';
    g[14][0] = '1';
    g[14][1] = '1';
    g[14][2] = 'b';
    g[13][1] = '9';
  }
  if (!hasS && !hasE) {
    g[15][15] = '.';
    g[15][14] = '1';
    g[14][15] = '1';
    g[14][14] = '1';
    g[14][13] = 'b';
    g[13][14] = 'b';
  }

  return g.map((r) => r.join(''));
}

const grids: Record<string, string[]> = {};
for (let mask = 0; mask < 16; mask++) {
  grids[`cliff_m${mask}`] = buildCliffTile(mask);
  grids[`grass_m${mask}`] = buildGrassTile(mask);
}

grids.vine_hang = [
  '.1671..171.1671.',
  '.1261..161.1761.',
  '..1761.1671161..',
  '..1621.1761171..',
  '...171..161.161.',
  '...1671.171.121.',
  '....171.161..1..',
  '....161.1271....',
  '.....1..1761....',
  '........161.....',
  '........1761....',
  '.........121....',
  '.........171....',
  '..........1.....',
  '................',
  '................',
];

grids.pebble_decal = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '........6...6...',
  '.......261.168..',
  '..111..1761671..',
  '.12ee1..17771...',
  '.1eff111111111..',
  '.11dd12ee11ff1..',
  '..111111111111..',
];

/**
 * 16x16 4-bit N/E/S/W auto-tile terrain grids (`cliff_m0..15`, `grass_m0..15`)
 * plus mossy overhang & pebble surface decals (`vine_hang`, `pebble_decal`).
 */
export const AUTO_TILE_SPRITE_GRIDS: Record<string, string[]> = grids;
