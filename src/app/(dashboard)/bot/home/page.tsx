import { redirect } from 'next/navigation';

export default function BotHomePage() {
  // Back-compat: some UI / notes referenced "/bot/home" as the dashboard landing page.
  redirect('/home');
}







