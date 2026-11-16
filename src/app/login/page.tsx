import {
  Droplets,
  PackageCheck,
  FlaskConical,
  ArrowLeft,
  GitBranch,
  ShieldCheck,
  Globe,
} from 'lucide-react';
import { LoginForm } from '@/components/login-form';
import { factoryProfile } from '@/config/factory-profile';
import { ui } from '@/locales/ar/ui';
import { workflowUi as w } from '@/locales/ar/workflow';
export const metadata = { title: ui.login };
export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand">
          <span className="brand-mark">
            <Droplets size={26} />
          </span>
          <span>
            <strong>{ui.brand}</strong>
            <small>{w.factory}</small>
          </span>
        </div>
        <div className="login-content">
          <p className="eyebrow">{ui.welcome}</p>
          <h1>{ui.loginTitle}</h1>
          <p className="muted">{ui.loginLead}</p>
          <LoginForm />
        </div>
        <div className="login-panel-foot">
          <small className="login-edition">{w.environment}</small>
          <a className="login-back-link" href={factoryProfile.websiteUrl}>
            <Globe size={14} />
            <span>{ui.backToOfficialSite}</span>
          </a>
        </div>
      </section>
      <aside className="login-art">
        <div>
          <span className="login-kicker">{w.loginKicker}</span>
          <h2>{w.loginTitle}</h2>
          <p>{w.loginText}</p>
        </div>
        <div className="login-process">
          {[PackageCheck, FlaskConical, GitBranch].map((Icon, i) => (
            <div className="login-process-item" key={i}>
              <span className="login-process-icon">
                <Icon size={23} />
              </span>
              <span>
                <small>0{i + 1}</small>
                <strong>{w.loginSteps[i]}</strong>
              </span>
              {i < 2 && <ArrowLeft size={18} />}
            </div>
          ))}
        </div>
        <div className="login-foot">
          <ShieldCheck size={18} />
          {w.loginFoot}
        </div>
      </aside>
    </main>
  );
}
