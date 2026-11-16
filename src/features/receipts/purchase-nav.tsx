import Link from 'next/link';
import { Boxes, TreePine, Droplets, Truck } from 'lucide-react';
import type { CatalogView } from '@/contracts/catalog';

const destinations = [
  { key: 'stock', href: '/purchases/stock', label: 'أرصدة المخزون', icon: Boxes },
  { key: 'raw', href: '/purchases/catalog?view=raw', label: 'المواد الخام', icon: TreePine },
  {
    key: 'finished',
    href: '/purchases/catalog?view=finished',
    label: 'دهون العود',
    icon: Droplets,
  },
  { key: 'suppliers', href: '/purchases/catalog?view=suppliers', label: 'الموردون', icon: Truck },
] as const;

export function PurchaseNav({ active }: { active: 'receipts' | 'stock' | CatalogView }) {
  return (
    <nav className="purchase-destinations" aria-label="صفحات المشتريات">
      {destinations.map((item) => (
        <Link
          key={item.key}
          className={`purchase-destination${active === item.key ? ' selected' : ''}`}
          href={item.href}
          aria-current={active === item.key ? 'page' : undefined}
        >
          <span className="destination-icon">
            <item.icon size={22} aria-hidden="true" />
          </span>
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
