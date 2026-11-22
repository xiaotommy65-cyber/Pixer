import type { RhythmCourseClearRecord } from '../core/rhythm/RhythmProgression.ts';
import {
  DEFAULT_RHYTHM_PLAYER_CONFIG,
  validateRhythmProject,
  type RhythmDifficulty,
  type RhythmPlayRecord,
  type RhythmPlayerConfig,
  type RhythmSongProject,
} from '../core/rhythm/RhythmTypes.ts';

const CONFIG_KEY = 'pixer.rhythm.config.v1';
const RECORDS_KEY = 'pixer.rhythm.records.v1';
const COURSES_KEY = 'pixer.rhythm.courses.v1';
const PROFILE_META_KEY = 'pixer.rhythm.profileMeta.v1';
const CUSTOM_SONGS_KEY = 'pixer.rhythm.customSongs.v1';
const IDB_NAME = 'pixer_rhythm_audio_v1';
const IDB_STORE = 'audio_blobs';

export type RhythmRecordMap = Record<string, RhythmPlayRecord>;
export type RhythmCourseRecordMap = Record<string, RhythmCourseClearRecord>;

export interface RhythmProfileMeta {
  totalPlays: number;
  lastPlayedAt: number;
}

export function makeRecordKey(songId: string, difficulty: RhythmDifficulty): string {
  return `${songId}::${difficulty}`;
}

export class RhythmStorage {
  public loadConfig(): RhythmPlayerConfig {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return { ...DEFAULT_RHYTHM_PLAYER_CONFIG, keyBindings: [...DEFAULT_RHYTHM_PLAYER_CONFIG.keyBindings] };
      const parsed = JSON.parse(raw) as Partial<RhythmPlayerConfig>;
      return {
        scrollSpeed: clampNum(parsed.scrollSpeed, 1.0, 6.0, DEFAULT_RHYTHM_PLAYER_CONFIG.scrollSpeed),
        audioOffsetMs: clampNum(parsed.audioOffsetMs, -250, 250, DEFAULT_RHYTHM_PLAYER_CONFIG.audioOffsetMs),
        visualOffsetMs: clampNum(parsed.visualOffsetMs, -150, 150, DEFAULT_RHYTHM_PLAYER_CONFIG.visualOffsetMs),
        keyBindings:
          Array.isArray(parsed.keyBindings) && parsed.keyBindings.length === 4
            ? [
                String(parsed.keyBindings[0]),
                String(parsed.keyBindings[1]),
                String(parsed.keyBindings[2]),
                String(parsed.keyBindings[3]),
              ]
            : [...DEFAULT_RHYTHM_PLAYER_CONFIG.keyBindings],
        laneDim: clampNum(parsed.laneDim, 0.4, 0.95, DEFAULT_RHYTHM_PLAYER_CONFIG.laneDim),
        cameraDynamic: typeof parsed.cameraDynamic === 'boolean' ? parsed.cameraDynamic : true,
        hitsoundPreset:
          parsed.hitsoundPreset === 'clap' ||
          parsed.hitsoundPreset === 'tick' ||
          parsed.hitsoundPreset === 'crystal' ||
          parsed.hitsoundPreset === 'off'
            ? parsed.hitsoundPreset
            : 'clap',
        perspectiveHighway: typeof parsed.perspectiveHighway === 'boolean' ? parsed.perspectiveHighway : true,
      };
    } catch {
      return { ...DEFAULT_RHYTHM_PLAYER_CONFIG, keyBindings: [...DEFAULT_RHYTHM_PLAYER_CONFIG.keyBindings] };
    }
  }

  public saveConfig(cfg: RhythmPlayerConfig): void {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    } catch {
      // Ignore quota errors
    }
  }

  public loadRecords(): RhythmRecordMap {
    try {
      const raw = localStorage.getItem(RECORDS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as RhythmRecordMap;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  public saveRecordIfBest(record: RhythmPlayRecord): { isNewBest: boolean; best: RhythmPlayRecord } {
    const map = this.loadRecords();
    const key = makeRecordKey(record.songId, record.difficulty);
    const prev = map[key];
    const isNewBest = !prev || record.score > prev.score;
    if (isNewBest) {
      map[key] = record;
      try {
        localStorage.setItem(RECORDS_KEY, JSON.stringify(map));
      } catch {
        // Ignore storage quota errors
      }
    }
    return { isNewBest, best: map[key] ?? record };
  }

  public loadCourseRecords(): RhythmCourseRecordMap {
    try {
      const raw = localStorage.getItem(COURSES_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as RhythmCourseRecordMap;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  public saveCourseRecordIfBest(record: RhythmCourseClearRecord): RhythmCourseClearRecord {
    const map = this.loadCourseRecords();
    const prev = map[record.courseId];
    const shouldSave =
      !prev ||
      (record.cleared && !prev.cleared) ||
      (record.cleared === prev.cleared && record.totalScore > prev.totalScore);
    if (shouldSave) {
      map[record.courseId] = record;
      try {
        localStorage.setItem(COURSES_KEY, JSON.stringify(map));
      } catch {
        // Ignore quota errors
      }
    }
    return map[record.courseId] ?? record;
  }

  public loadProfileMeta(): RhythmProfileMeta {
    try {
      const raw = localStorage.getItem(PROFILE_META_KEY);
      if (!raw) return { totalPlays: 0, lastPlayedAt: 0 };
      const parsed = JSON.parse(raw) as Partial<RhythmProfileMeta>;
      return {
        totalPlays: typeof parsed.totalPlays === 'number' && Number.isFinite(parsed.totalPlays) ? parsed.totalPlays : 0,
        lastPlayedAt: typeof parsed.lastPlayedAt === 'number' && Number.isFinite(parsed.lastPlayedAt) ? parsed.lastPlayedAt : 0,
      };
    } catch {
      return { totalPlays: 0, lastPlayedAt: 0 };
    }
  }

  public incrementPlayCount(): RhythmProfileMeta {
    const meta = this.loadProfileMeta();
    meta.totalPlays += 1;
    meta.lastPlayedAt = Date.now();
    try {
      localStorage.setItem(PROFILE_META_KEY, JSON.stringify(meta));
    } catch {
      // Ignore quota errors
    }
    return meta;
  }

  public loadCustomProjects(): RhythmSongProject[] {
    try {
      const raw = localStorage.getItem(CUSTOM_SONGS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw) as unknown[];
      if (!Array.isArray(arr)) return [];
      const out: RhythmSongProject[] = [];
      for (const item of arr) {
        const v = validateRhythmProject(item);
        if (v.ok) out.push(v.project);
      }
      return out;
    } catch {
      return [];
    }
  }

  public saveCustomProject(project: RhythmSongProject): void {
    const list = this.loadCustomProjects();
    const idx = list.findIndex((p) => p.id === project.id);
    if (idx >= 0) list[idx] = project;
    else list.unshift(project);
    try {
      localStorage.setItem(CUSTOM_SONGS_KEY, JSON.stringify(list));
    } catch {
      // Ignore quota errors
    }
  }

  public deleteCustomProject(songId: string): void {
    const list = this.loadCustomProjects();
    const target = list.find((p) => p.id === songId);
    const next = list.filter((p) => p.id !== songId);
    try {
      localStorage.setItem(CUSTOM_SONGS_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }
    if (target?.audioSource.kind === 'custom') {
      void this.deleteAudioBlob(target.audioSource.storageKey);
    }
  }

  public async saveAudioBlob(storageKey: string, data: ArrayBuffer): Promise<void> {
    const db = await this.openDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(data.slice(0), storageKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async loadAudioBlob(storageKey: string): Promise<ArrayBuffer | null> {
    const db = await this.openDb();
    if (!db) return null;
    return new Promise<ArrayBuffer | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(storageKey);
      req.onsuccess = () => {
        const val = req.result;
        resolve(val instanceof ArrayBuffer ? val : null);
      };
      req.onerror = () => resolve(null);
    });
  }

  public async deleteAudioBlob(storageKey: string): Promise<void> {
    const db = await this.openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(storageKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  private openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise<IDBDatabase | null>((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, v));
}
