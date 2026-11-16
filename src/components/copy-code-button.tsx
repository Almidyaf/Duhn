'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

export function CopyCodeButton({ code, label = 'نسخ الرمز' }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
    } catch {
      /* Clipboard may be unavailable in restricted contexts. */
    }
  }

  return (
    <button
      type="button"
      className="quiet-button"
      aria-label={copied ? 'تم النسخ' : `${label}: ${code}`}
      title={copied ? 'تم النسخ' : label}
      onClick={copy}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? 'تم النسخ' : 'نسخ'}</span>
    </button>
  );
}
