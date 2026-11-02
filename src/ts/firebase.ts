import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// NOTE: Firebase の Web 設定は秘匿情報ではなく、実質的な防御は firestore.rules 側で行う。
// （他のミニアプリと同様に、この値はコミットして良い）
const firebaseConfig = {
  apiKey: 'AIzaSyBhI7DAN3B48XgWDCF3bC3ZcKOiK5Iix0g',
  authDomain: 'ningenryoku-dojo.firebaseapp.com',
  projectId: 'ningenryoku-dojo',
  storageBucket: 'ningenryoku-dojo.firebasestorage.app',
  messagingSenderId: '667865172903',
  appId: '1:667865172903:web:ccbe2f2acaa2974065c482',
};

export const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
