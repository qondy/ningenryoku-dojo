/** 人間スキルのキー（options.ts の SKILLS と対応） */
export type SkillKey = 'question' | 'listen' | 'decide' | 'involve' | 'trust' | 'read' | 'negotiate' | 'convey';

/** 稽古の手応え。good=うまくいった / soso=まあまあ / hard=むずかしかった */
export type Feel = 'good' | 'soso' | 'hard';

export interface Skill {
  key: SkillKey;
  /** 図鑑で使う一文字 */
  mark: string;
  name: string;
  /** レーダーチャート用の短い名前 */
  label: string;
  /** ひとことで */
  short: string;
  /** なぜAIには難しいか */
  whyHuman: string;
  /** 稽古のコツ */
  tip: string;
  /** 5分でできる実践お題 */
  drills: string[];
}

/** users/{uid}/practices/{id} */
export interface Practice {
  id: string;
  skill: SkillKey;
  /** 稽古した日 YYYY-MM-DD */
  date: string;
  /** 取り組んだお題（自由記録なら空） */
  drill: string;
  /** どんな場面で */
  scene: string;
  /** やってみてどうだったか */
  result: string;
  feel: Feel;
  /** 気づき・次はこうする */
  insight: string;
  /** 語れるエピソードとして証拠の棚に入れたか */
  episode: boolean;
  createdAt: number;
}

/** users/{uid}/assessments/{YYYY-MM} 月1回の自己評価（各スキル1〜5） */
export interface Assessment {
  month: string;
  scores: Record<SkillKey, number>;
  memo: string;
}
