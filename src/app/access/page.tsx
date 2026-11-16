import { ShieldCheck } from 'lucide-react';
import { Logout } from '@/components/logout';
import { ui } from '@/locales/ar/ui';
export default function AccessPage() {
  return (
    <main className="standalone-message">
      <ShieldCheck size={42} />
      <h1>{ui.noAccess}</h1>
      <p>{ui.noAccessText}</p>
      <Logout />
    </main>
  );
}
