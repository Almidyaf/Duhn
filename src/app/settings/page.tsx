import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requireMember } from '@/server/members';
import { AppError } from '@/server/errors';
import { getFactorySettings } from '@/server/settings';
import { Shell } from '@/components/shell';
import { SettingsForm } from '@/features/settings/settings-form';
import { settingsUi } from '@/locales/ar/settings';
export const dynamic = 'force-dynamic';
export const metadata = { title: settingsUi.title };
export default async function SettingsPage() {
  const member = await requireMember(await headers()).catch((error: unknown) => {
    if (error instanceof AppError && error.status === 401) redirect('/login');
    if (error instanceof AppError && error.status === 403) redirect('/access');
    throw error;
  });
  if (member.role === 'operator') redirect('/access');
  return (
    <Shell member={member} section="settings">
      <SettingsForm
        initial={await getFactorySettings(member)}
        userId={member.id}
        isOwner={member.role === 'owner'}
        timezones={['UTC', ...Intl.supportedValuesOf('timeZone')]}
      />
    </Shell>
  );
}
