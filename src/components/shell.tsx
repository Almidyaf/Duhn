import {
  Boxes,
  ShoppingBag,
  FlaskConical,
  ChartNoAxesCombined,
  Droplets,
  Settings,
  ChevronLeft,
} from 'lucide-react';
import Link from 'next/link';
import type { Member } from '@/server/members';
import { Logout } from './logout';
import { Notifications } from './notifications';
import { ui } from '@/locales/ar/ui';
import { workflowUi as w } from '@/locales/ar/workflow';
export function Shell({
  member,
  children,
  section = 'assets',
}: {
  member: Member;
  children: React.ReactNode;
  section?: 'assets' | 'purchases' | 'settings' | 'production' | 'reports';
}) {
  return (
    <div className="workspace">
      <a href="#main" className="skip-link">
        {ui.skip}
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/production">
          <span className="brand-mark">
            <Droplets size={25} />
          </span>
          <span>
            <strong>{ui.brand}</strong>
            <small>{w.factory}</small>
          </span>
        </Link>
        <p className="nav-caption">{w.workspace}</p>
        <nav aria-label={w.navigation}>
          {(
            [
              { key: 'assets', href: '/assets', Icon: Boxes },
              { key: 'purchases', href: '/purchases/stock', Icon: ShoppingBag },
              { key: 'production', href: '/production', Icon: FlaskConical },
              { key: 'reports', href: '/reports', Icon: ChartNoAxesCombined },
            ] as const
          ).map(({ key, href, Icon }) => (
            <Link
              key={key}
              className={`nav-item ${section === key ? 'selected' : ''}`}
              href={href}
              aria-current={section === key ? 'page' : undefined}
            >
              <Icon size={19} />
              <span>{ui[key]}</span>
              {section === key && <ChevronLeft size={15} className="nav-chevron" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-note">
          <Droplets size={18} />
          <div>
            <strong>{ui.brandSubtitle}</strong>
            <small>{w.environment}</small>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{w.workspace}</span>
            <ChevronLeft size={14} />
            <strong>{ui[section]}</strong>
          </div>
          <div className="account">
            {member.role !== 'operator' && <Notifications userId={member.id} />}
            <Link
              className="icon-button settings-link"
              href="/settings"
              aria-label={ui.settings}
              title={ui.settings}
            >
              <Settings size={19} />
            </Link>
            <span className="account-divider" />
            <span className="avatar">{member.name.slice(0, 1)}</span>
            <span className="account-name">
              <strong>{member.name}</strong>
              <small>{ui[member.role]}</small>
            </span>
            <Logout />
          </div>
        </header>
        <main id="main" className="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
