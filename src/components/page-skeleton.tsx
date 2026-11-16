import {
  Boxes,
  ShoppingBag,
  FlaskConical,
  ChartNoAxesCombined,
  Droplets,
  ChevronLeft,
} from 'lucide-react';
import { ui } from '@/locales/ar/ui';
import { workflowUi as w } from '@/locales/ar/workflow';

const navItems = [
  { key: 'assets', Icon: Boxes },
  { key: 'purchases', Icon: ShoppingBag },
  { key: 'production', Icon: FlaskConical },
  { key: 'reports', Icon: ChartNoAxesCombined },
] as const;

export function PageSkeleton({
  section,
}: {
  section: 'assets' | 'purchases' | 'settings' | 'production' | 'reports';
}) {
  return (
    <div className="workspace" aria-busy="true" aria-label={ui[section]}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Droplets size={25} />
          </span>
          <span>
            <strong>{ui.brand}</strong>
            <small>{w.factory}</small>
          </span>
        </div>
        <p className="nav-caption">{w.workspace}</p>
        <nav aria-label={w.navigation}>
          {navItems.map(({ key, Icon }) => (
            <div key={key} className={`nav-item ${section === key ? 'selected' : ''}`}>
              <Icon size={19} />
              <span>{ui[key]}</span>
              {section === key && <ChevronLeft size={15} className="nav-chevron" />}
            </div>
          ))}
        </nav>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{w.workspace}</span>
            <ChevronLeft size={14} />
            <strong>{ui[section]}</strong>
          </div>
          <span className="skeleton-bar" style={{ width: 120 }} />
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <span className="skeleton-bar title" />
            </div>
            <span className="skeleton-bar button" />
          </div>
          <section className="assets-panel">
            <div className="skeleton-rows">
              {Array.from({ length: 5 }, (_, i) => (
                <div className="skeleton-row" key={i}>
                  <span className="skeleton-bar" />
                  <span className="skeleton-bar" />
                  <span className="skeleton-bar" />
                  <span className="skeleton-bar" />
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
