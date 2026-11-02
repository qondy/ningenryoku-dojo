import { Assessment, Practice, SkillKey } from './types';
import { practiceXp, SKILLS, TITLES, XP_PER_LEVEL } from './options';
import { addDays, hashString, todayKey } from './dates';

export function totalXp(practices: Practice[]): number {
  return practices.reduce((sum, p) => sum + practiceXp(p), 0);
}

export function titleOf(xp: number): { name: string; min: number; next: { min: number; name: string } | null } {
  let idx = 0;
  TITLES.forEach((t, i) => { if (xp >= t.min) idx = i; });
  return { name: TITLES[idx].name, min: TITLES[idx].min, next: TITLES[idx + 1] ?? null };
}

export interface SkillStat {
  key: SkillKey;
  xp: number;
  count: number;
  level: number;
  /** 次のレベルまでの進み具合 0〜1 */
  progress: number;
}

export function skillStats(practices: Practice[]): Record<SkillKey, SkillStat> {
  const map = {} as Record<SkillKey, SkillStat>;
  SKILLS.forEach((s) => { map[s.key] = { key: s.key, xp: 0, count: 0, level: 1, progress: 0 }; });
  practices.forEach((p) => {
    map[p.skill].xp += practiceXp(p);
    map[p.skill].count += 1;
  });
  Object.values(map).forEach((s) => {
    s.level = 1 + Math.floor(s.xp / XP_PER_LEVEL);
    s.progress = (s.xp % XP_PER_LEVEL) / XP_PER_LEVEL;
  });
  return map;
}

/** 稽古した日が続いている日数（今日か昨日まで続いていれば有効） */
export function streak(practices: Practice[]): number {
  const days = new Set(practices.map((p) => p.date));
  let cur = todayKey();
  if (!days.has(cur)) cur = addDays(cur, -1);
  let count = 0;
  while (days.has(cur)) {
    count += 1;
    cur = addDays(cur, -1);
  }
  return count;
}

/** 日付ごとの稽古数 */
export function countByDate(practices: Practice[]): Map<string, number> {
  const map = new Map<string, number>();
  practices.forEach((p) => map.set(p.date, (map.get(p.date) ?? 0) + 1));
  return map;
}

export function latestAssessment(list: Assessment[]): Assessment | null {
  return list.length ? list[list.length - 1] : null;
}

/**
 * 今日の稽古で鍛えるスキル。
 * 自己評価があれば点数がいちばん低いもの（同点なら稽古回数が少ないもの）、
 * なければ日替わりで順番に。
 */
export function todaySkill(practices: Practice[], assessments: Assessment[], day: string): SkillKey {
  const latest = latestAssessment(assessments);
  if (!latest) return SKILLS[hashString(day) % SKILLS.length].key;
  const stats = skillStats(practices);
  const sorted = [...SKILLS].sort((a, b) =>
    latest.scores[a.key] - latest.scores[b.key] || stats[a.key].count - stats[b.key].count);
  return sorted[0].key;
}

/** スキルのお題を日替わりで選ぶ（offset で「別のお題」） */
export function drillIndex(skill: SkillKey, day: string, offset: number, length: number): number {
  return (hashString(`${day}:${skill}`) + offset) % length;
}
