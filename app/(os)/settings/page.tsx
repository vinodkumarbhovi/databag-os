import { SettingsView } from '@/components/SettingsView';
import { CATALOG, TOOLS } from '@/lib/catalog';
import { aiFromEnv, loadConfig, logoUrl } from '@/lib/config';
import { requireUser } from '@/lib/session';

export default async function SettingsPage() {
  const user = await requireUser();
  const config = loadConfig();
  return (
    <SettingsView
      me={{ name: user.name, isAdmin: user.role === 'admin' }}
      company={config.company}
      ai={{ baseUrl: config.ai.baseUrl, model: config.ai.model }}
      logo={logoUrl(config)}
      aiSetup={{
        provider: /11434/.test(config.ai.baseUrl) ? 'local' : config.ai.baseUrl.includes('openrouter.ai') ? 'openrouter' : config.ai.baseUrl.includes('api.openai.com') ? 'openai' : 'custom',
        model: config.ai.model, baseUrl: config.ai.baseUrl, hasKey: !!config.ai.apiKey, fromEnv: aiFromEnv(),
      }}
      smtpPort={config.smtp.port}
      hasRelay={!!config.relay}
      tools={TOOLS.map((t) => ({ ...t, appNames: t.apps.map((id) => CATALOG.find((a) => a.id === id)?.name ?? id), installed: t.apps.some((id) => config.apps.includes(id)) }))}
      chosenTools={config.tools ?? []}
      agent={{ confirm: config.agent?.confirm ?? 'send', cleanup: config.speech?.cleanup !== false }}
    />
  );
}
