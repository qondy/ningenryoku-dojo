import {
  collection, doc, onSnapshot, setDoc, addDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { Assessment, Feel, Practice, SkillKey } from './types';
import { SKILL_KEYS } from './options';

const FEELS: Feel[] = ['good', 'soso', 'hard'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const millis = (v: unknown): number =>
  (v && typeof (v as { toMillis?: unknown }).toMillis === 'function'
    ? (v as { toMillis: () => number }).toMillis() : Date.now());

const practicesCol = (uid: string) => collection(db, 'users', uid, 'practices');
const practiceDoc = (uid: string, id: string) => doc(db, 'users', uid, 'practices', id);
const assessmentsCol = (uid: string) => collection(db, 'users', uid, 'assessments');
const assessmentDoc = (uid: string, month: string) => doc(db, 'users', uid, 'assessments', month);

export function subscribePractices(
  uid: string,
  onData: (items: Practice[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(practicesCol(uid), (snap) => {
    const list: Practice[] = [];
    snap.forEach((d) => {
      const data = d.data();
      if (!SKILL_KEYS.includes(data.skill) || typeof data.date !== 'string' || !DATE_RE.test(data.date)) return;
      list.push({
        id: d.id,
        skill: data.skill,
        date: data.date,
        drill: str(data.drill),
        scene: str(data.scene),
        result: str(data.result),
        feel: FEELS.includes(data.feel) ? data.feel : 'soso',
        insight: str(data.insight),
        episode: data.episode === true,
        createdAt: millis(data.createdAt),
      });
    });
    list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    onData(list);
  }, onError);
}

export function subscribeAssessments(
  uid: string,
  onData: (items: Assessment[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(assessmentsCol(uid), (snap) => {
    const list: Assessment[] = [];
    snap.forEach((d) => {
      if (!MONTH_RE.test(d.id)) return;
      const data = d.data();
      const raw = (data.scores && typeof data.scores === 'object') ? data.scores as Record<string, unknown> : {};
      const scores = {} as Record<SkillKey, number>;
      SKILL_KEYS.forEach((k) => {
        const v = Number(raw[k]);
        scores[k] = Number.isInteger(v) && v >= 1 && v <= 5 ? v : 1;
      });
      list.push({ month: d.id, scores, memo: str(data.memo) });
    });
    list.sort((a, b) => a.month.localeCompare(b.month));
    onData(list);
  }, onError);
}

export type PracticeInput = Omit<Practice, 'id' | 'createdAt'>;

export async function createPractice(uid: string, input: PracticeInput): Promise<void> {
  await addDoc(practicesCol(uid), {
    ...input,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export function updatePractice(uid: string, id: string, input: PracticeInput): Promise<void> {
  return setDoc(practiceDoc(uid, id), { ...input, updatedAt: serverTimestamp() }, { merge: true });
}

export function setEpisode(uid: string, id: string, episode: boolean): Promise<void> {
  return setDoc(practiceDoc(uid, id), { episode, updatedAt: serverTimestamp() }, { merge: true });
}

export function deletePractice(uid: string, id: string): Promise<void> {
  return deleteDoc(practiceDoc(uid, id));
}

export function saveAssessment(uid: string, a: Assessment): Promise<void> {
  return setDoc(assessmentDoc(uid, a.month), {
    scores: a.scores,
    memo: a.memo,
    updatedAt: serverTimestamp(),
  });
}
