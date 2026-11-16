import type { Metadata } from 'next';
import { GuestPlantCheckForm } from './GuestPlantCheckForm';
export const metadata: Metadata = { title: 'Plant Daily Check', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default function GuestPlantChecksPage() { return <GuestPlantCheckForm />; }
