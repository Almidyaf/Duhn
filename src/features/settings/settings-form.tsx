'use client';
import { useState } from 'react';
import { factoryProfile } from '@/config/factory-profile';
import { factorySettingsInputSchema, type FactorySettings } from '@/contracts/settings';
import { settingsUi as s } from '@/locales/ar/settings';
import { ui } from '@/locales/ar/ui';
import { useConfigurationWrite } from './use-configuration-write';
import { fetchJson, WriteFeedback } from '../catalog/shared';
export function SettingsForm({
  initial,
  userId,
  isOwner,
  timezones,
}: {
  initial: FactorySettings;
  userId: string;
  isOwner: boolean;
  timezones: string[];
}) {
  const [settings, setSettings] = useState(initial);
  const write = useConfigurationWrite(userId, async (result) => {
    if (result && typeof result === 'object' && 'version' in result) {
      setSettings(result as FactorySettings);
    } else {
      setSettings(await fetchJson<FactorySettings>('/api/v1/settings'));
    }
  });
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (write.locked || !isOwner) return;
    const form = new FormData(event.currentTarget);
    const parsed = factorySettingsInputSchema.safeParse({
      name: form.get('name'),
      timezone: form.get('timezone'),
      week_starts_on: Number(form.get('week')),
      measurement_confirmed: form.get('measurement') === 'on',
      expected_version: settings.version,
    });
    if (!parsed.success) {
      write.setError(s.errors.INVALID_INPUT);
      return;
    }
    await write.submit('/api/v1/settings', 'PATCH', parsed.data);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">{ui.brandSubtitle}</p>
          <h1>{s.title}</h1>
          <p className="muted">{s.lead}</p>
        </div>
      </div>
      <section className="notice" aria-label={s.businessDetails}>
        <h2>{s.businessDetails}</h2>
        <p>
          <strong>{factoryProfile.name}</strong>
        </p>
        <p>{factoryProfile.location}</p>
        <p dir="ltr">{factoryProfile.address}</p>
        <a href={factoryProfile.mapsUrl} target="_blank" rel="noopener noreferrer">
          {s.openMaps}
        </a>
      </section>
      <WriteFeedback write={write} />
      <p className={`notice ${settings.configured ? 'success' : 'warning'}`}>
        {settings.configured ? s.configured : s.unconfigured}
      </p>
      <form className="settings-form assets-panel" key={settings.version} onSubmit={submit}>
        <fieldset className="plain-fieldset" disabled={!isOwner || write.locked}>
          <label>
            {s.name}
            <input
              name="name"
              required
              minLength={2}
              maxLength={120}
              defaultValue={
                settings.configured ? settings.name : settings.name || factoryProfile.name
              }
            />
          </label>
          <label>
            {s.timezone}
            <select
              aria-label={s.timezone}
              aria-describedby="timezone-help"
              name="timezone"
              required
              defaultValue={settings.timezone ?? factoryProfile.timezone}
            >
              <option value="" disabled>
                {s.chooseTimezone}
              </option>
              <optgroup label="مناطق شائعة">
                {[
                  factoryProfile.timezone,
                  'Asia/Riyadh',
                  'Asia/Dubai',
                  'Asia/Kuwait',
                  'Asia/Qatar',
                  'UTC',
                ]
                  .filter((zone, index, arr) => arr.indexOf(zone) === index && timezones.includes(zone))
                  .map((zone) => (
                    <option key={`common-${zone}`} value={zone}>
                      {zone === factoryProfile.timezone ? s.localTimezone : zone}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="جميع المناطق الزمنية">
                {timezones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone === factoryProfile.timezone ? s.localTimezone : zone}
                  </option>
                ))}
              </optgroup>
            </select>
            <small id="timezone-help" className="field-hint">
              {s.timezoneHint}
            </small>
          </label>
          <label>
            {s.week}
            <select
              aria-label={s.week}
              aria-describedby="week-help"
              name="week"
              required
              defaultValue={settings.week_starts_on ?? ''}
            >
              <option value="" disabled>
                {s.chooseDay}
              </option>
              {s.days.map((day, i) => (
                <option key={day} value={i}>
                  {day}
                </option>
              ))}
            </select>
            <small id="week-help" className="field-hint">
              {s.weekHint}
            </small>
          </label>
          <p>{s.precision}</p>
          {isOwner && (
            <label className="checkbox-label">
              <input type="checkbox" name="measurement" required />
              {s.measurement}
            </label>
          )}
          {isOwner && (
            <button className="primary-button" disabled={write.locked}>
              {write.busy ? ui.saving : s.save}
            </button>
          )}
        </fieldset>
      </form>
      <p className="record-note">{s.scope}</p>
    </>
  );
}
