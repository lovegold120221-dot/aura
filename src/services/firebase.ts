import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';
import firebaseConfigRaw from '../../firebase-applet-config.json';

const firebaseConfig = {
  ...firebaseConfigRaw,
  databaseURL: `https://${firebaseConfigRaw.projectId}-default-rtdb.asia-southeast1.firebasedatabase.app`
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfigRaw.firestoreDatabaseId);
export const rtdb = getDatabase(app);
export const auth = getAuth();
export const googleProvider = new GoogleAuthProvider();
